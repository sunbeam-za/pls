import type {
  Collection,
  FolderNode,
  RequestItem,
  RequestNode,
  Store,
  TreeNode
} from '../../../preload/index'

export type { Store, Collection, FolderNode, RequestItem, RequestNode, TreeNode }

export const newId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const newRequest = (name = 'Untitled request'): RequestItem => ({
  id: newId(),
  name,
  method: 'GET',
  url: '',
  headers: [],
  body: ''
})

export const newCollection = (name = 'New collection'): Collection => ({
  id: newId(),
  name,
  children: []
})
