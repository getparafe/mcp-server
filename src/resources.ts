/**
 * MCP resource definitions for the Parafe Trust Broker.
 */

export const RESOURCE_DEFINITIONS = [
  {
    uri: 'parafe://agent',
    name: 'Parafe Agent Identity',
    description: "Current agent's identity: agent ID, name, verification tier, identity assurance, credential expiry, scope policies. Returns 'no credentials loaded' if unregistered.",
    mimeType: 'application/json',
  },
  {
    uri: 'parafe://public-key',
    name: 'Parafe Broker Public Key',
    description: "The broker's current Ed25519 public key for independent signature verification.",
    mimeType: 'application/json',
  },
];

export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'parafe://session/{sessionId}',
    name: 'Parafe Session',
    description: 'Session status, participants, consent tokens, and actions logged.',
    mimeType: 'application/json',
  },
];
