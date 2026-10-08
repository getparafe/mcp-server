/**
 * MCP resource definitions for the Parafe Trust Broker.
 */

export const RESOURCE_DEFINITIONS = [
  {
    uri: 'parafe://agent',
    name: 'Parafe Agent Identity',
    description: "Whether an agent's credentials are loaded: its agent ID and name, when the credential expires, and whether it has expired. { loaded: false } before parafe_register.",
    mimeType: 'application/json',
  },
  {
    uri: 'parafe://public-key',
    name: 'Parafe Broker Keys',
    description: "The broker's signing keys (JWKS: the active ES256 key and retired keys), for independent signature verification.",
    mimeType: 'application/json',
  },
];

export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'parafe://session/{sessionId}',
    name: 'Parafe Session',
    description: "A session the loaded agent takes part in: its action-receipt index and, once closed, its signed receipt.",
    mimeType: 'application/json',
  },
];
