/**
 * Pet profile GraphQL client. Transport, retry, and token refresh live on {@link module:session}.
 */
const { WhiskerTokenException } = require('../common/exceptions');
const { PET_GRAPHQL_ENDPOINT, PET_GET_PETS_BY_USER_QUERY } = require('./constants');

/**
 * Retrieves all pets for the authenticated user.
 * @param {import('../session')} session
 * @param {string} userId
 * @returns {Promise<Array<Object>>}
 */
async function getPets(session, userId) {
  if (!userId) {
    throw new WhiskerTokenException('Unable to get user ID from token');
  }

  const response = await session._makeGraphQLRequest(PET_GRAPHQL_ENDPOINT, {
    query: PET_GET_PETS_BY_USER_QUERY,
    variables: { userId },
  }, 'Pet');

  const pets = response.data?.getPetsByUser || [];
  session.homey.log(`[Session] Fetched ${pets.length} pets`);
  return pets;
}

module.exports = { getPets };
