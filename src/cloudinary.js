
const CLOUD_NAME = 'zuwo0szw'
const UPLOAD_PRESET = 'propertyhub_upload'

export async function uploadToCloudinary(file) {
  const formData = new FormData()

  formData.append('file', file)
  formData.append('upload_preset', UPLOAD_PRESET)

  const resourceType = file.type.startsWith('video/') ? 'video' : 'image'

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`,
    {
      method: 'POST',
      body: formData,
    }
  )

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error?.message || 'Upload failed')
  }

  return data.secure_url
}
