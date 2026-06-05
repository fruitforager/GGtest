export default {
  async fetch(request, env, ctx) {
    return new Response(String(!!env.CIMIS_APP_KEY));
  }
};
