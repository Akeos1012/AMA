const API_BASE_URL = "http://127.0.0.1:8000";

export async function authenticatedFetch(user, endpoint, options = {}) {
  if (!user) {
    throw new Error("An authenticated user is required for this request.");
  }

  const token = await user.getIdToken();
  return fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}
