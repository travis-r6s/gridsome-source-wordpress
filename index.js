/* eslint-disable no-prototype-builtins */
const HTMLParser = require('node-html-parser')
const camelCase = require('camelcase')
const consola = require('consola')
const fs = require('fs-extra')
const got = require('got').default
const isPlainObject = require('lodash.isplainobject')
const os = require('os')
const pMap = require('p-map')
const path = require('path')
const stream = require('stream')
const { promisify } = require('util')

const TYPE_AUTHOR = 'author'
const TYPE_ATTACHMENT = 'attachment'

const logger = consola.create({
  defaults: { tag: '@gridsome/source-wordpress' }
})

class WordPressSource {
  static defaultOptions () {
    return {
      baseUrl: '',
      replaceUrl: '',
      apiBase: 'wp-json',
      hostingWPCOM: false,
      perPage: 100,
      concurrent: os.cpus().length,
      typeName: 'WordPress',
      images: false,
      content: true,
      verbose: false,
      ignoreSSL: false,
      woocommerce: false
    }
  }

  constructor (api, options) {
    if (!options.baseUrl) {
      throw new Error(logger.error('Missing the `baseUrl` option - please add, and try again.'))
    }

    if (!options.baseUrl.includes('http') && !options.hostingWPCOM) {
      throw new Error(logger.error('`baseUrl` does not include the protocol - please add, and try again (`http://` or `https://`).'))
    }

    if (!options.typeName) {
      options.typeName = 'WordPress'
      logger.warn('Missing the `typeName` option - defaulting to `WordPress`.')
    }

    if (options.perPage > 100 || options.perPage < 1) {
      options.perPage = 100
      logger.warn('`perPage` cannot be more than 100 or less than 1 - defaulting to 100.')
    }

    const baseUrl = options.baseUrl.replace(/\/$/, '')
    const clientBase = options.hostingWPCOM ? `https://public-api.wordpress.com/wp/v2/sites/${baseUrl}/` : `${baseUrl}/${options.apiBase}/wp/v2/`

    this.options = {
      ...options,
      baseUrl
    }
    this.restBases = { posts: {}, taxonomies: {} }

    this.customEndpoints = this.sanitizeCustomEndpoints()

    this.client = got.extend({
      prefixUrl: clientBase,
      searchParams: { per_page: this.options.perPage },
      resolveBodyOnly: true,
      responseType: 'json',
      https: { rejectUnauthorized: !this.options.ignoreSSL }
    })

    if (this.options.woocommerce) {
      const { consumerKey, consumerSecret } = this.options.woocommerce
      if (!consumerKey) throw new Error('Missing WooCommerce `consumerKey`.')
      if (!consumerSecret) throw new Error('Missing WooCommerce `consumerSecret`.')

      const woocommerceBase = this.options.hostingWPCOM ? `https://public-api.wordpress.com/wc/v3/sites/${baseUrl}/` : `${baseUrl}/${options.apiBase}/wc/v3/`

      this.woocommerce = this.client.extend({
        prefixUrl: woocommerceBase,
        username: consumerKey,
        password: consumerSecret
      })
    }

    api.loadSource(async actions => {
      this.store = actions

      logger.info(`Loading data from ${this.options.baseUrl}`)

      this.addSchemaTypes(actions)

      await this.getPostTypes(actions)
      await this.getUsers(actions)
      await this.getTaxonomies(actions)
      await this.getPosts(actions)
      await this.getCustomEndpoints(actions)

      if (this.options.woocommerce) {
        await this.getWooCommerceProducts(actions)
        await this.getWooCommerceCategories(actions)
      }
    })

    api.onBootstrap(async () => {
      this.downloadImages(api)
    })
  }

  addSchemaTypes (actions) {
    actions.addSchemaTypes(`
      type ${this.createTypeName(TYPE_ATTACHMENT)} implements Node @infer {
        downloaded: Image
      }
    `)
  }

  async getPostTypes (actions) {
    if (this.options.verbose) logger.info(`Fetching types`)

    const data = await this.fetch('types', {}, {})

    for (const type in data) {
      if (type === 'product' && this.options.woocommerce) continue

      if (this.options.verbose) logger.info(`Fetching ${type}s`)

      const options = data[ type ]

      this.restBases.posts[ type ] = options.rest_base

      actions.addCollection(this.createTypeName(type))
    }
  }

  async getUsers (actions) {
    if (this.options.verbose) logger.info(`Fetching users`)

    const data = await this.fetch('users')

    const authors = actions.addCollection(this.createTypeName(TYPE_AUTHOR))

    for (const author of data) {
      const fields = this.normalizeFields(author)

      const avatars = Object.entries(author.avatar_urls || {}).reduce((obj, [key, value]) => ({ ...obj, [ `avatar${key}` ]: value }), {})

      authors.addNode({
        ...fields,
        id: author.id,
        title: author.name,
        avatars
      })
    }
  }

  async getTaxonomies (actions) {
    if (this.options.verbose) logger.info(`Fetching taxonomies`)

    const data = await this.fetch('taxonomies', {}, {})

    for (const type in data) {
      if (this.options.verbose) logger.info(`Fetching ${type} taxonomy type`)

      const options = data[ type ]
      const taxonomy = actions.addCollection(this.createTypeName(type))

      this.restBases.taxonomies[ type ] = options.rest_base

      const terms = await this.fetchPaged(options.rest_base)

      for (const term of terms) {
        taxonomy.addNode({
          id: term.id,
          title: term.name,
          slug: term.slug,
          content: term.description,
          meta: term.meta,
          count: term.count
        })
      }
    }
  }

  async getPosts (actions) {
    const AUTHOR_TYPE_NAME = this.createTypeName(TYPE_AUTHOR)
    const ATTACHMENT_TYPE_NAME = this.createTypeName(TYPE_ATTACHMENT)

    for (const type in this.restBases.posts) {
      if (this.options.verbose) logger.info(`Fetching ${type} post type`)

      const restBase = this.restBases.posts[ type ]
      const typeName = this.createTypeName(type)
      const posts = actions.getCollection(typeName)

      const data = await this.fetchPaged(restBase)
      for (const post of data) {
        let fields = this.normalizeFields(post)

        fields.author = actions.createReference(AUTHOR_TYPE_NAME, post.author || '0')

        if (post.type !== TYPE_ATTACHMENT) {
          fields.featuredMedia = actions.createReference(ATTACHMENT_TYPE_NAME, post.featured_media)
        }

        if (this.options.content) {
          fields = await this.parseContent(fields)
        }

        // add references if post has any taxonomy rest bases as properties
        for (const type in this.restBases.taxonomies) {
          const propName = this.restBases.taxonomies[ type ]

          if (post.hasOwnProperty(propName)) {
            const typeName = this.createTypeName(type)
            const key = camelCase(propName)

            fields[ key ] = Array.isArray(post[ propName ])
              ? post[ propName ].map(id => actions.createReference(typeName, id))
              : actions.createReference(typeName, post[ propName ])
          }
        }

        posts.addNode({ ...fields, id: post.id })
      }
    }
  }

  async getCustomEndpoints (actions) {
    for (const endpoint of this.customEndpoints) {
      if (this.options.verbose) logger.info(`Fetching custom ${endpoint.typeName} type`)

      const customCollection = actions.addCollection(endpoint.typeName)

      const data = await this.fetch(endpoint.route)

      for (let item of data) {
        if (endpoint.normalize) {
          item = this.normalizeFields(item)
        }

        customCollection.addNode({
          ...item,
          id: item.id || item.slug
        })
      }
    }
  }

  async getWooCommerceProducts (actions) {
    if (this.options.verbose) logger.info(`Fetching WooCommerce products`)

    const ATTACHMENT_TYPE_NAME = this.createTypeName(TYPE_ATTACHMENT)
    const CATEGORY_TYPE_NAME = this.createTypeName('ProductCategory')
    const PRODUCT_TYPE_NAME = this.createTypeName('Product')
    const PRODUCT_VARIATION_TYPE_NAME = this.createTypeName('ProductVariation')

    const productCollection = actions.addCollection(PRODUCT_TYPE_NAME)
    productCollection.addReference('groupedProducts', PRODUCT_TYPE_NAME)
    productCollection.addReference('variations', PRODUCT_VARIATION_TYPE_NAME)

    const productVariationCollection = actions.addCollection(PRODUCT_VARIATION_TYPE_NAME)
    productVariationCollection.addReference('image', ATTACHMENT_TYPE_NAME)

    const products = await this.fetchPaged('products', this.woocommerce)

    for (const product of products) {
      let fields = this.normalizeFields(product)

      if (this.options.content) {
        fields = await this.parseContent(fields)
      }

      const categories = fields.categories.map(category => actions.createReference(CATEGORY_TYPE_NAME, category.id))
      const images = fields.images.map(image => actions.createReference(ATTACHMENT_TYPE_NAME, image.id))

      const upsells = fields.upsellIds.map(id => actions.createReference(PRODUCT_TYPE_NAME, id))
      const crossSells = fields.crossSellIds.map(id => actions.createReference(PRODUCT_TYPE_NAME, id))
      const related = fields.relatedIds.map(id => actions.createReference(PRODUCT_TYPE_NAME, id))

      productCollection.addNode({
        ...fields,
        categories,
        images,
        upsells,
        crossSells,
        related
      })
    }

    if (this.options.verbose) logger.info(`Fetching WooCommerce product variations`)

    const allVariableProducts = products.filter(product => product.type === 'variable')
    const allVariableProductVariations = await pMap(allVariableProducts, product => this.fetch(`products/${product.id}/variations`, {}, [], this.woocommerce), { concurrency: this.options.concurrent })

    for (const variation of allVariableProductVariations.flat()) {
      let fields = this.normalizeFields(variation)

      if (this.options.content) {
        fields = await this.parseContent(fields)
      }

      productVariationCollection.addNode(fields)
    }
  }

  async getWooCommerceCategories (actions) {
    if (this.options.verbose) logger.info(`Fetching WooCommerce categories`)

    const ATTACHMENT_TYPE_NAME = this.createTypeName(TYPE_ATTACHMENT)
    const CATEGORY_TYPE_NAME = this.createTypeName('ProductCategory')
    const PRODUCT_TYPE_NAME = this.createTypeName('Product')

    const productCollection = actions.getCollection(PRODUCT_TYPE_NAME)
    const categoryCollection = actions.addCollection(CATEGORY_TYPE_NAME)
    categoryCollection.addReference('parent', CATEGORY_TYPE_NAME)

    const categories = await this.fetchPaged('products/categories', this.woocommerce)

    for (const category of categories) {
      const fields = this.normalizeFields(category)

      const image = fields.image ? actions.createReference(ATTACHMENT_TYPE_NAME, fields.image.id) : null

      const products = productCollection.data()
        .filter(({ categories }) => categories.some(({ id }) => id === category.id.toString()))
        .map(({ id }) => actions.createReference(PRODUCT_TYPE_NAME, id))

      const children = categories.filter(({ parent }) => parent === category.id)
        .map(({ id }) => actions.createReference(CATEGORY_TYPE_NAME, id))

      categoryCollection.addNode({ ...fields, image, products, children })
    }
  }

  async fetch (url, params = {}, fallbackData = [], client = this.client) {
    try {
      const data = await client.get(url, { searchParams: params })
      return data
    } catch ({ response }) {
      logger.warn(`Status ${response.statusCode} fetching ${response.requestUrl}`)
      return fallbackData
    }
  }

  async fetchPaged (path, client = this.client) {
    try {
      const { headers } = await client.head(path, { resolveBodyOnly: false })

      const totalItems = parseInt(headers[ 'x-wp-total' ], 10)
      const totalPages = parseInt(headers[ 'x-wp-totalpages' ], 10)

      if (!totalItems) return []

      const queue = [...Array(totalPages)].map((_, i) => i + 1)

      const allData = await pMap(queue, async page => {
        try {
          const data = await this.fetch(path, { page }, [], client)
          return this.ensureArrayData(path, data)
        } catch (error) {
          logger.error(error.message)
        }
      }, { concurrency: this.options.concurrent })

      return allData.flat()
    } catch ({ response }) {
      logger.warn(`Status ${response.statusCode} fetching ${response.requestUrl}`)
      return []
    }
  }

  async parseContent (fields) {
    const { links = true, images = true } = this.options.content
    const fieldsToInclude = Array.isArray(links) ? ['content', ...links] : ['content']

    for await (const key of fieldsToInclude) {
      const html = HTMLParser.parse(fields[ key ])
      if (!html) continue

      if (links) {
        for (const link of html.querySelectorAll('a')) {
          const originalLink = link.getAttribute('href')
          const updatedLink = originalLink.replace(this.options.baseUrl, '')
          link.setAttribute('href', updatedLink)
        }
      }

      if (images) {
        const pipeline = promisify(stream.pipeline)
        for await (const img of html.querySelectorAll('img')) {
          const originalSrc = img.getAttribute('src')
          if (!originalSrc.includes(this.options.baseUrl)) continue

          const { pathname } = new URL(originalSrc)
          const fileUrl = pathname.replace('/wp-content', '')
          const filePath = path.join(process.cwd(), 'static', fileUrl)

          img.setAttribute('src', fileUrl)

          if (await fs.pathExists(filePath)) continue

          await fs.ensureFile(filePath)
          await pipeline(
            got.stream(originalSrc),
            fs.createWriteStream(filePath)
          )
        }
      }

      fields[ key ] = html.toString()
    }

    return fields
  }

  async downloadImages (api) {
    if (!this.options.images) return
    const { original = false, folder = '.images/wordpress', cache = true, concurrent = os.cpus().length } = this.options.images

    const imageStore = api._store.getCollection(this.createTypeName(TYPE_ATTACHMENT))
    const images = imageStore.data()

    const pipeline = promisify(stream.pipeline)

    await pMap(images, async image => {
      const { pathname } = new URL(image.sourceUrl)
      const { name, dir, ext } = path.parse(pathname)

      const targetFileName = original ? name : image.id
      const targetFolder = path.join(process.cwd(), folder, original ? dir : '')

      const filePath = path.format({ ext, name: targetFileName, dir: targetFolder })

      const updatedNode = { ...image, downloaded: filePath }

      if (cache && await fs.pathExists(filePath)) return imageStore.updateNode(updatedNode)

      try {
        await fs.ensureFile(filePath)
        await pipeline(
          got.stream(image.sourceUrl),
          fs.createWriteStream(filePath)
        )

        return imageStore.updateNode(updatedNode)
      } catch (error) {
        logger.error(error.message)
      }
    }, { concurrency: concurrent })
  }

  sanitizeCustomEndpoints () {
    const { customEndpoints } = this.options
    if (!customEndpoints) return []

    if (!Array.isArray(customEndpoints)) {
      throw new Error(logger.error('`customEndpoints` must be an array.'))
    }

    for (const endpoint of customEndpoints) {
      if (!endpoint.typeName) {
        throw new Error(logger.error('Please provide a `typeName` option for all customEndpoints'))
      }
      if (!endpoint.route) {
        throw new Error(logger.error(`\`route\` option is missing in endpoint ${endpoint.typeName}. Ex: \`apiName/versionNumber/endpointObject\``))
      }
    }

    return customEndpoints
  }

  ensureArrayData (url, data) {
    if (Array.isArray(data)) return data

    try {
      data = JSON.parse(data)
    } catch (err) {
      logger.error(`Failed to fetch ${url} - expected JSON response, but received ${typeof data} type.`)
    }
  }

  normalizeFields (fields) {
    const res = {}

    for (const key in fields) {
      if (key.startsWith('_')) continue // skip links and embeds etc
      res[ camelCase(key) ] = this.normalizeFieldValue(fields[ key ])
    }

    return res
  }

  normalizeFieldValue (value) {
    if (value === null) return null
    if (value === undefined) return null

    if (Array.isArray(value)) {
      return value.map(v => this.normalizeFieldValue(v))
    }

    if (isPlainObject(value)) {
      if (value.post_type && (value.ID || value.id)) {
        const typeName = this.createTypeName(value.post_type)
        const id = value.ID || value.id

        return this.store.createReference(typeName, id)
      } else if (value.filename && (value.ID || value.id)) {
        const typeName = this.createTypeName(TYPE_ATTACHMENT)
        const id = value.ID || value.id

        return this.store.createReference(typeName, id)
      } else if (value.hasOwnProperty('rendered')) {
        return value.rendered
      }

      return this.normalizeFields(value)
    }

    return value
  }

  createTypeName (name = '') {
    return camelCase(`${this.options.typeName} ${name}`, { pascalCase: true })
  }
}

module.exports = WordPressSource
