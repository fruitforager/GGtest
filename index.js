export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://fruitforager.github.io',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // 1. Handle browser pre-checks (OPTIONS)
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. Ensure it only runs for the /api/cimis path
    const url = new URL(request.url);
    if (url.pathname !== '/api/cimis') {
      return new Response('Path Not Found', { status: 404, headers: corsHeaders });
    }

    // 3. Talk to CIMIS using your securely saved key
        try {
      const cimisUrl = new URL('https://et.water.ca.gov/api/data');
      cimisUrl.search = url.search;
      cimisUrl.searchParams.set('appKey', env.CIMIS_APP_KEY);
      
      if (env.CIMIS_APP_KEY) {
        cimisUrl.searchParams.set('appKey', env.CIMIS_APP_KEY);
      }

      const response = await fetch(cimisUrl.toString());
      const data = await response.text();

      return new Response(data, {
        status: response.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};
