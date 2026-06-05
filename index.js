export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://fruitforager.github.io',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response('Hello from root!', { headers: corsHeaders });
    }

    if (url.pathname !== '/api/cimis') {
      return new Response('Path Not Found', { status: 404, headers: corsHeaders });
    }

    try {
      const cimisUrl = new URL('https://et.water.ca.gov/api/data');
      cimisUrl.search = url.search;
      cimisUrl.searchParams.set('appKey', env.CIMIS_APP_KEY);

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
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }
  },
};
