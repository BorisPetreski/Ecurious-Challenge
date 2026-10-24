'use strict';

window.addEventListener('DOMContentLoaded', () => {
  window.ui = SwaggerUIBundle({
    urls: [
      { name: 'BayReady backend', url: '/api/openapi.json' },
      { name: 'Ecurious hardware · observed contract', url: '/api/openapi-ecurious.json' },
    ],
    'urls.primaryName': 'BayReady backend',
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: 'StandaloneLayout',
    deepLinking: true,
    filter: true,
    displayRequestDuration: true,
    defaultModelsExpandDepth: 1,
    docExpansion: 'list',
    persistAuthorization: false,
    queryConfigEnabled: false,
    validatorUrl: null,
  });
});
