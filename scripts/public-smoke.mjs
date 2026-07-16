const webUrl = process.env.PUBLIC_WEB_URL
const apiUrl = process.env.PUBLIC_API_URL

if (!webUrl || !apiUrl) {
  throw new Error('PUBLIC_WEB_URL and PUBLIC_API_URL are required.')
}

function resolveUrl(baseUrl, path) {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
}

async function fetchOrThrow(label, url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`)
  }

  return response
}

const webResponse = await fetchOrThrow('Web login', resolveUrl(webUrl, 'login'))
const healthResponse = await fetchOrThrow('API health', resolveUrl(apiUrl, 'health'))
const health = await healthResponse.json()

if (health.status !== 'ok' || health.db !== 'ok') {
  throw new Error('API health did not confirm a ready database dependency.')
}

console.log(`Public smoke passed: web=${webResponse.status}, api=${healthResponse.status}, db=${health.db}`)
