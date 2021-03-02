import { Schema } from './types'

export function createSchema ({ addSchemaTypes }: Schema, { createTypeName, woocommerce = false }: { createTypeName: (name: string) => string, woocommerce: boolean }): void {
  const ATTACHMENT_TYPE_NAME = createTypeName('Attachment')
  const AUTHOR_TYPE_NAME = createTypeName('Author')
  const CATEGORY_TYPE_NAME = createTypeName('Category')
  const POST_TYPE_NAME = createTypeName('Post')
  const TAG_TYPE_NAME = createTypeName('PostTag')

  addSchemaTypes(`
    type ${ATTACHMENT_TYPE_NAME} implements Node @infer {
      downloaded: Image
    }

    type ${TAG_TYPE_NAME} {
      id: Int
      name: String
      slug: String
    }

    type ${POST_TYPE_NAME} implements Node @infer {
      id: Int
      date: Date
      slug: String
      status: String
      type: String
      title: String
      content: String
      excerpt: String
      author: ${AUTHOR_TYPE_NAME}
      featuredMedia: ${ATTACHMENT_TYPE_NAME}
      categories: [${CATEGORY_TYPE_NAME}]
      tags: [${TAG_TYPE_NAME}]
    }

    type ${CATEGORY_TYPE_NAME} implements Node @infer {
      id: Int
      count: Int
      description: String
      name: String
      slug: String
      taxonomy: String
      parent: ${CATEGORY_TYPE_NAME}
      children: [${POST_TYPE_NAME}]
    }

    type ${AUTHOR_TYPE_NAME} implements Node @infer {
      id: Int
      name: String
      description: String
      slug: String
    }
  `)

  if (woocommerce) {
    const ATTRIBUTES_TYPE_NAME = createTypeName('ProductAttributes')
    const ATTRIBUTE_TYPE_NAME = createTypeName('VariationAttribute')
    const PRODUCT_CATEGORY_TYPE_NAME = createTypeName('ProductCategory')
    const PRODUCT_TYPE_NAME = createTypeName('Product')
    const PRODUCT_VARIATION_TYPE_NAME = createTypeName('ProductVariation')

    addSchemaTypes(`
      type ${ATTRIBUTES_TYPE_NAME} {
        id: Int
        name: String
        position: Int
        visible: Boolean
        variation: Boolean
        options: [String]
      }
      type ${ATTRIBUTE_TYPE_NAME} {
        id: Int
        name: String
        option: String
      }

      type ${PRODUCT_TYPE_NAME} implements Node @infer {
        id: Int
        name: String
        slug: String
        dateCreated: Date
        dateModified: Date
        type: String
        status: String
        featured: Boolean
        catalogVisibility: String
        description: String
        shortDescription: String
        sku: String
        price: String
        regularPrice: String
        salePrice: String
        onSale: Boolean
        purchaseable: Boolean
        backordersAllowed: Boolean
        weight: String
        menuOrder: Int
        attributes: [${ATTRIBUTES_TYPE_NAME}]
        defaultAttributes: [${ATTRIBUTE_TYPE_NAME}]
        tags: [${TAG_TYPE_NAME}]
        upsells: [${PRODUCT_TYPE_NAME}]
        crossSells: [${PRODUCT_TYPE_NAME}]
        parent: ${PRODUCT_TYPE_NAME}
        categories: [${PRODUCT_CATEGORY_TYPE_NAME}]
        images: [${ATTACHMENT_TYPE_NAME}]
        variations: [${PRODUCT_TYPE_NAME}]
        grouped: [${PRODUCT_TYPE_NAME}]
        related: [${PRODUCT_TYPE_NAME}]
      }

      type ${PRODUCT_VARIATION_TYPE_NAME} implements Node @infer {
        id: Int
        dateCreated: Date
        dateModified: Date
        description: String
        sku: String
        price: String
        regularPrice: String
        salePrice: String
        onSale: String
        state: String
        weight: String
        image: ${ATTACHMENT_TYPE_NAME}
        attributes: [${ATTRIBUTE_TYPE_NAME}]
        menuOrder: Int
      }

      type ${PRODUCT_CATEGORY_TYPE_NAME} implements Node @infer {
        id: Int
        name: String
        slug: String
        parent: ${PRODUCT_CATEGORY_TYPE_NAME}
        children: [${PRODUCT_TYPE_NAME}]
        description: String
        display: String
        image: ${ATTACHMENT_TYPE_NAME}
        menuOrder: Int
        count: Int
      }
    `)
  }
}
