/**
 * A chosen PDF as the base64 the upload routes take. Browser-only by use (`FileReader`), and
 * import-free, so it is safe in any client component. The profile page's reconcile upload and the
 * resume page's upload both read their file through this one function.
 */

/** Strips the `data:application/pdf;base64,` prefix the FileReader adds. */
export function readPdfAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(file)
  })
}
