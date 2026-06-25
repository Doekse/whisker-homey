/**
 * Pet profile GraphQL documents and API endpoints shared by session and schema tooling.
 */

/** Pet profile GraphQL HTTP endpoint. */
const PET_GRAPHQL_ENDPOINT = 'https://pet-profile.iothings.site/graphql';

/** GraphQL query document for listing pets by Cognito user id (`getPets`). */
const PET_GET_PETS_BY_USER_QUERY = `
query GetPetsByUser($userId: String!) {
  getPetsByUser(userId: $userId) {
    petId, name, gender, lastWeightReading, breeds, birthday, s3ImageURL,
    diet, environmentType, healthConcerns, isActive
  }
}
`.trim();

module.exports = {
  PET_GRAPHQL_ENDPOINT,
  PET_GET_PETS_BY_USER_QUERY,
};
