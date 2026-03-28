/**
 * MCP tool definitions for the Parafe Trust Broker.
 * Each tool maps to a ParafeClient SDK method (except parafe_discover).
 */

import { ParafeClient } from '@getparafe/sdk';

// ── Tool name constants ──

export const TOOL_NAMES = {
  DISCOVER: 'parafe_discover',
  REGISTER: 'parafe_register',
  INITIATE_HANDSHAKE: 'parafe_initiate_handshake',
  COMPLETE_HANDSHAKE: 'parafe_complete_handshake',
  ESCALATE_SCOPE: 'parafe_escalate_scope',
  VERIFY_CONSENT: 'parafe_verify_consent',
  RECORD_ACTION: 'parafe_record_action',
  CLOSE_SESSION: 'parafe_close_session',
  VERIFY_RECEIPT: 'parafe_verify_receipt',
  REVOKE_AGENT: 'parafe_revoke_agent',
  RENEW_CREDENTIAL: 'parafe_renew_credential',
  UPDATE_SCOPE_POLICIES: 'parafe_update_scope_policies',
  GET_PUBLIC_KEY: 'parafe_get_public_key',
  VERIFY_CONSENT_LOCALLY: 'parafe_verify_consent_locally',
} as const;

// ── Tool definitions (name, description, inputSchema) ──

export const TOOL_DEFINITIONS = [
  {
    name: TOOL_NAMES.DISCOVER,
    description: `Fetch a target agent's agent card to discover its Parafe trust requirements before initiating a handshake. Agent cards are hosted at the target's well-known URL (e.g., https://example.com/.well-known/agent.json).

This is the first step before any handshake. The agent card tells you:
- Whether the target requires Parafe trust (look for the Parafe extension with 'required: true')
- The target's Parafe agent ID (needed for parafe_initiate_handshake)
- The broker URL
- Available scopes and their requirements: what permissions each scope grants, what authorization modality is required (autonomous, attested, or verified), and what minimum identity assurance level is needed

Always discover before handshaking. The agent card tells you whether your credentials meet the target's requirements — saving a round trip if they don't.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_card_url: {
          type: 'string',
          description: "URL of the target agent's agent card (e.g., 'https://example.com/.well-known/agent.json'). If a base domain is provided without a path, '/.well-known/agent.json' is appended automatically.",
        },
      },
      required: ['agent_card_url'],
    },
  },
  {
    name: TOOL_NAMES.REGISTER,
    description: `Register a new agent identity with the Parafe trust network. This generates an Ed25519 cryptographic key pair, sends the public key to the Parafe broker, and receives a signed credential. Call this once to establish your agent's identity — credentials are saved automatically and persist across sessions.

You must register before you can initiate or complete trust handshakes. If you already have credentials loaded, this returns your existing agent info.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Agent name. Lowercase alphanumeric and hyphens, 3-100 characters.',
        },
        type: {
          type: 'string',
          enum: ['personal', 'enterprise'],
          description: "Agent type. Use 'enterprise' for business agents, 'personal' for individual agents.",
        },
        owner: {
          type: 'string',
          description: 'Organization or individual that owns this agent.',
        },
        scope_policies: {
          type: 'object',
          description: 'Optional scope policies defining what interactions this agent accepts.',
          additionalProperties: {
            type: 'object',
            properties: {
              permissions: { type: 'array', items: { type: 'string' } },
              exclusions: { type: 'array', items: { type: 'string' } },
              minimum_authorization_modality: { type: 'string', enum: ['autonomous', 'attested', 'verified'] },
              minimum_identity_assurance: { type: 'string', enum: ['self_registered', 'registered'] },
              minimum_verification_tier: { type: 'string', enum: ['unverified', 'email_verified', 'domain_verified', 'org_verified'] },
            },
            required: ['permissions'],
          },
        },
      },
      required: ['name', 'type', 'owner'],
    },
  },
  {
    name: TOOL_NAMES.INITIATE_HANDSHAKE,
    description: `Start a trust handshake with another agent. This begins a mutual authentication process where both agents cryptographically prove their identities before any interaction occurs.

You must specify:
- The target agent's Parafe ID
- A scope name describing the type of interaction (e.g., 'flight-rebooking', 'data-sharing')
- The specific permissions you're requesting within that scope

The target agent must complete the handshake (using parafe_complete_handshake) within 5 minutes. Once complete, you receive a scoped consent token that defines exactly what this interaction is authorized to do.

Use 'autonomous' authorization (default) when acting on your own. Use 'attested' when you're acting on a human's instruction. Use 'verified' when you have cryptographic proof of human approval.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        target_agent_id: {
          type: 'string',
          description: "Parafe agent ID of the agent to handshake with (starts with 'prf_agent_').",
        },
        scope: {
          type: 'string',
          description: "Type of interaction (e.g., 'flight-rebooking', 'data-sharing', 'payment-processing').",
        },
        permissions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific actions you are requesting permission for within the scope.',
        },
        authorization_modality: {
          type: 'string',
          enum: ['autonomous', 'attested', 'verified'],
          description: "Level of human authorization. 'autonomous' = agent acting alone (default). 'attested' = agent claims human instructed this. 'verified' = cryptographic proof of human approval.",
        },
        authorization_evidence: {
          type: 'object',
          description: "Evidence for 'attested' or 'verified' modality. Required if modality is not 'autonomous'.",
          properties: {
            instruction: { type: 'string', description: 'What the human instructed (required for attested and verified).' },
            platform: { type: 'string', description: 'Platform that attested or verified the instruction (required for attested and verified).' },
            timestamp: { type: 'string', description: 'ISO 8601 timestamp of when the instruction was given. Auto-set to now if omitted.' },
            user_signature: { type: 'string', description: "Cryptographic signature from user device (required for 'verified' modality only)." },
          },
        },
        context: {
          type: 'object',
          description: 'Optional context passed to the broker and visible in receipts (e.g., user ID, account reference).',
        },
      },
      required: ['target_agent_id', 'scope', 'permissions'],
    },
  },
  {
    name: TOOL_NAMES.COMPLETE_HANDSHAKE,
    description: `Complete a trust handshake that another agent initiated with you. This signs the cryptographic challenge with your private key, proving your identity to the Parafe broker.

You need the handshake_id and challenge_nonce from the initiation. The handshake must be completed within 5 minutes of initiation.

On success, returns a session with a scoped consent token defining what both agents are authorized to do.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        handshake_id: {
          type: 'string',
          description: "Handshake ID from the initiation (starts with 'hs_').",
        },
        challenge_nonce: {
          type: 'string',
          description: '64-character hex nonce from the handshake initiation.',
        },
      },
      required: ['handshake_id', 'challenge_nonce'],
    },
  },
  {
    name: TOOL_NAMES.ESCALATE_SCOPE,
    description: `Request additional permissions within an existing authenticated session. This avoids re-handshaking when the interaction needs to expand beyond its original scope.

For example, if a flight-rebooking session needs to also process a payment, you can escalate from 'flight-rebooking' scope to add 'payment-processing' scope within the same session. A new consent token is issued for the escalated scope.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: "Active session ID (starts with 'sess_').",
        },
        target_agent_id: {
          type: 'string',
          description: 'Target agent ID (must match the session participant).',
        },
        scope: {
          type: 'string',
          description: 'New scope to request.',
        },
        permissions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Actions for the new scope.',
        },
        authorization_modality: {
          type: 'string',
          enum: ['autonomous', 'attested', 'verified'],
        },
        authorization_evidence: {
          type: 'object',
          properties: {
            instruction: { type: 'string', description: 'What the human instructed (required for attested and verified).' },
            platform: { type: 'string', description: 'Platform that attested or verified the instruction (required for attested and verified).' },
            timestamp: { type: 'string', description: 'ISO 8601 timestamp of when the instruction was given. Auto-set to now if omitted.' },
            user_signature: { type: 'string', description: "Cryptographic signature from user device (required for 'verified' modality only)." },
          },
        },
      },
      required: ['session_id', 'target_agent_id', 'scope', 'permissions'],
    },
  },
  {
    name: TOOL_NAMES.VERIFY_CONSENT,
    description: `Check whether a specific action is permitted by a consent token before performing it. Call this before taking any scoped action to ensure you're operating within the agreed boundaries.

Returns whether the action is permitted, and if not, why (e.g., action is in the exclusion list, token expired, scope mismatch).`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        consent_token: {
          type: 'string',
          description: 'JWT consent token from a completed handshake.',
        },
        action: {
          type: 'string',
          description: 'Action to check permission for.',
        },
        session_id: {
          type: 'string',
          description: 'Session ID the consent token belongs to.',
        },
      },
      required: ['consent_token', 'action', 'session_id'],
    },
  },
  {
    name: TOOL_NAMES.RECORD_ACTION,
    description: `Log an action you're performing within an active session. This creates an auditable record that appears in the session's signed receipt.

Record each significant action you take during the interaction. If a consent token is provided, the broker validates that the action is within scope and rejects it if not.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: 'Active session ID.',
        },
        action: {
          type: 'string',
          description: 'Action being performed (should match a permission from the consent token).',
        },
        details: {
          type: 'object',
          description: 'Optional details about the action (e.g., booking reference, data accessed).',
        },
        consent_token: {
          type: 'string',
          description: 'Optional consent token. If provided, the broker validates the action is within scope.',
        },
      },
      required: ['session_id', 'action'],
    },
  },
  {
    name: TOOL_NAMES.CLOSE_SESSION,
    description: `Close an active session and generate a cryptographically signed receipt. The receipt is an Ed25519-signed record of the trust context: who participated, what was consented to, what actions were recorded, and when.

Both parties can independently verify this receipt. It serves as neutral, tamper-proof evidence of the interaction.

Always close sessions when the interaction is complete.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: "Session ID to close (starts with 'sess_').",
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: TOOL_NAMES.VERIFY_RECEIPT,
    description: `Verify a receipt's Ed25519 signature to confirm it was genuinely issued by the Parafe broker and has not been tampered with. Use this to independently validate interaction records.

Returns whether the signature is valid and whether any tampering was detected.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        receipt: {
          type: 'object',
          description: "Full receipt object including the 'signature' field, as returned by parafe_close_session.",
        },
      },
      required: ['receipt'],
    },
  },
  {
    name: TOOL_NAMES.REVOKE_AGENT,
    description: `Permanently revoke an agent's identity. The agent's credentials become invalid and it can no longer participate in handshakes. This cannot be undone.

Use this when an agent should be decommissioned or if credentials may have been compromised.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: "Agent ID to revoke (starts with 'prf_agent_').",
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: TOOL_NAMES.RENEW_CREDENTIAL,
    description: `Renew an agent's credential to reflect the organization's current verification tier. Call this after your organization completes email or domain verification to upgrade your agent's trust level.

Credentials expire after 30 days. Renew before expiry to maintain uninterrupted trust capabilities.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent ID to renew credentials for.',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: TOOL_NAMES.UPDATE_SCOPE_POLICIES,
    description: `Update the scope policies that define what interactions this agent accepts. Scope policies let you declare which permissions you allow, which you exclude, and what minimum trust requirements counterparties must meet.

For example, you can require that any agent requesting 'payment-processing' scope must have 'verified' authorization modality and 'domain_verified' verification tier.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent ID to update scope policies for.',
        },
        scope_policies: {
          type: 'object',
          description: 'New scope policies. Keys are scope names. Each value defines permissions (required), exclusions, and minimum trust requirements.',
          additionalProperties: {
            type: 'object',
            properties: {
              permissions: { type: 'array', items: { type: 'string' } },
              exclusions: { type: 'array', items: { type: 'string' } },
              minimum_authorization_modality: { type: 'string', enum: ['autonomous', 'attested', 'verified'] },
              minimum_identity_assurance: { type: 'string', enum: ['self_registered', 'registered'] },
              minimum_verification_tier: { type: 'string', enum: ['unverified', 'email_verified', 'domain_verified', 'org_verified'] },
            },
            required: ['permissions'],
          },
        },
      },
      required: ['agent_id', 'scope_policies'],
    },
  },
  {
    name: TOOL_NAMES.GET_PUBLIC_KEY,
    description: `Get the Parafe broker's Ed25519 public key. This key can be used to independently verify any Parafe-signed artifact (credentials, consent tokens, receipts) without calling the broker.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: TOOL_NAMES.VERIFY_CONSENT_LOCALLY,
    description: `Verify a consent token locally using the broker's Ed25519 public key — no network call required. Use this when you need to validate a consent token offline or in a latency-sensitive path.

Provide the JWT consent token and the broker's base64-encoded Ed25519 public key (from parafe_get_public_key). Returns the decoded token payload if valid, or an error if the signature is invalid or the token is expired.

Use parafe_verify_consent (network round-trip) when you also want the broker to check the action against scope policy. Use this tool when you only need signature and expiry validation.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        consent_token: {
          type: 'string',
          description: 'JWT consent token to verify.',
        },
        broker_public_key: {
          type: 'string',
          description: "Broker's Ed25519 public key in base64 format (from parafe_get_public_key or the parafe://public-key resource).",
        },
      },
      required: ['consent_token', 'broker_public_key'],
    },
  },
];

// ── Authorization builder helper ──

interface AuthorizationEvidence {
  instruction?: string;
  platform?: string;
  timestamp?: string;
  user_signature?: string;
}

export function buildAuthorization(modality?: string, evidence?: AuthorizationEvidence) {
  if (!modality || modality === 'autonomous') {
    return ParafeClient.authorization.autonomous();
  }
  if (modality === 'attested') {
    return ParafeClient.authorization.attested({
      instruction: evidence?.instruction ?? '',
      platform: evidence?.platform ?? '',
      timestamp: evidence?.timestamp,
    });
  }
  if (modality === 'verified') {
    return ParafeClient.authorization.verified({
      instruction: evidence?.instruction ?? '',
      platform: evidence?.platform ?? '',
      userSignature: evidence?.user_signature ?? '',
      timestamp: evidence?.timestamp,
    });
  }
  return ParafeClient.authorization.autonomous();
}
