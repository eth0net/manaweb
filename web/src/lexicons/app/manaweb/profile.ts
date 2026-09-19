export interface BlobRef {
  $type: 'blob'
  ref: { $link: string }
  mimeType: string
  size: number
}

export interface Main {
  $type: 'app.manaweb.profile'
  /** Square image shown beside the account name. */
  avatar: BlobRef
  [k: string]: unknown
}
