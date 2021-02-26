export interface CustomEndpointOption {
  typeName: string
  route: string
  normalize: string
}
export interface ImageOptions {
  original: boolean
  folder: string
  cache: boolean
  concurrent: number
}

export interface PluginOptions {
  apiBase: string
  baseUrl: string
  concurrent: number
  content: { links: boolean, images: boolean }
  customEndpoints: CustomEndpointOption[]
  hostingWPCOM: boolean
  ignoreSSL: boolean
  images: ImageOptions | boolean
  perPage: number
  typeName: string
  verbose: boolean
  woocommerce: { consumerKey: string, consumerSecret: string } | null
}

export interface Store {
  addCollection: (typeName: string) => Collection
  addSchemaTypes: (schema: string) => void
  createReference: (typeName: string, id: string) => NodeReference
  getCollection: (typeName: string) => Collection
}

export interface Collection {
  addNode: (node: any) => void
  addReference: (field: string, typeName: string) => void
  data: () => any[]
  updateNode: (node: any) => void
}

export interface NodeReference {
  id: string
  typeName: string
}

export interface Schema {
  addSchemaTypes: (schema: string | string[]) => void
  schema: {
    createObjectType: (options: { name: string, fields: Record<string, string>, extensions?: Record<string, string | boolean>, interfaces?: string[] }) => void
  }
}
