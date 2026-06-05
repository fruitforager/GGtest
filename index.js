export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (pathname === '/api/cimis') {
      const appKey = env.CIMIS_APP_KEY;
      const targets = searchParams.get('targets') || '75';
      const startDate = searchParams.get('startDate');
      const endDate = searchParams.get('endDate');
      const dataItems = searchParams.get('dataItems') || 'day,dayEto,dayPrecip';

      if (!appKey) {
        return new Response(JSON.stringify({
          error: 'Missing CIMIS app key',
          hint: 'Set CIMIS_APP_KEY in Cloudflare Worker secrets',
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        });
      }

      const cimisUrl = new URL('https://et.water.ca.gov/api/data');
      cimisUrl.searchParams.set('appKey', appKey);
      cimisUrl.searchParams.set('targets', targets);
      cimisUrl.searchParams.set('dataItems', dataItems);
      if (startDate) cimisUrl.searchParams.set('startDate', startDate);
      if (endDate) cimisUrl.searchParams.set('endDate', endDate);

      try {
        const response = await fetch(cimisUrl.toString(), {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        });

        const text = await response.text();

        return new Response(JSON.stringify({
          ok: response.ok,
          status: response.status,
          upstreamUrl: cimisUrl.toString(),
          body: text,
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({
          error: 'CIMIS fetch failed',
          message: String(err),
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        });
      }
    }

    return new Response('Not found', {
      status: 404,
      headers: corsHeaders,
    });
  }
};
