/**
 * Auth attributes for the isolated Room-Board visual-regression fixture.
 *
 * Hotel context and role are service-managed claims. PatelRep's API accepts
 * them only from a JWT's top-level claims or Supabase app_metadata, never
 * from user_metadata (which an end user can edit).
 */
export function buildFixtureAuthAttributes({ hotelId, fullName, role }) {
  return {
    app_metadata: { hotel_id: hotelId, role },
    user_metadata: { hotel_id: hotelId, full_name: fullName },
  }
}
