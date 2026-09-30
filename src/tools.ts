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
  GET_AGENT_METRICS: 'parafe_get_agent_metrics',
  GET_SESSION_RECEIPT: 'parafe_get_session_receipt',
  CREATE_PRESENTATION_PROOF: 'parafe_create_presentation_proof',
  CREATE_CLAIM_LINK: 'parafe_create_claim_link',
} as const;

// ── Tool definitions (name, description, inputSchema) ──

export const TOOL_DEFINITIONS = [
  {
    name: TOOL_NAMES.DISCOVER,
    description: `Fetch a target agent's agent card to discover its Parafe trust requirements before initiating a handshake. Agent cards are hosted at the target's well-known URL: https://example.com/.well-known/agent-card.json (A2A v1.0), or /.well-known/agent.json on older A2A v0.3 agents. Pass just the domain and both are tried.

This is the first step before any handshake. The agent card tells you:
- Whether the target requires Parafe trust (look for the Parafe extension with 'required: true')
- The target's Parafe agent ID (needed for parafe_initiate_handshake)
- The broker URL
- Available scopes and their requirements: what permissions each scope grants, what authorization modality is required (autonomous, attested, or verified), and what minimum identity assurance level is needed
- The target's A2A endpoints and the A2A protocol version each one speaks (interfaces)

Always discover before handshaking. The agent card tells you whether your credentials meet the target's requirements — saving a round trip if they don't.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_card_url: {
          type: 'string',
          description: "URL of the target agent's agent card (e.g., 'https://example.com/.well-known/agent-card.json'), or just its domain. For a bare domain, '/.well-known/agent-card.json' is tried first, then '/.well-known/agent.json'.",
        },
      },
      required: ['agent_card_url'],
    },
  },
  {
    name: TOOL_NAMES.REGISTER,
    description: `Register a new agent identity with the Parafe trust network. This generates a key pair (Ed25519 by default, or P-256 for AP2 interop), sends the public key to the Parafe broker, and receives a signed credential (a JWT, plus the same identity as an SD-JWT VC that binds your key). Call this once to establish your agent's identity — credentials are saved automatically and persist across sessions. Your private key never leaves this server; it signs a proof of possession on every request made as your agent.

You must register before you can initiate or complete trust handshakes. If you already have credentials loaded, this returns your existing agent info.

Registered without an API key, the agent has no owner (self_registered, unverified) and the result includes claimLink: show its url to the person you act for so they can verify you (see parafe_create_claim_link).`,
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
        key_algorithm: {
          type: 'string',
          enum: ['Ed25519', 'P-256'],
          description: "Key type. 'Ed25519' (default) or 'P-256' (ES256, the key type AP2 mandates use).",
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
              minimum_initiator_proof: { type: 'string', enum: ['pop', 'credential'] },
              description: { type: 'string' },
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

Use 'autonomous' authorization (default) when acting on your own. Use 'attested' when you're acting on a human's instruction. Don't use 'verified' yet: the broker refuses it (verified_evidence_unverifiable) until it can check a user-signed AP2 mandate, so a scope that requires 'verified' can't be reached today.`,
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
          description: "Level of human authorization. 'autonomous' = agent acting alone (default). 'attested' = agent states a human instructed this. 'verified' = a human signature the broker has checked; not accepted yet (the broker returns verified_evidence_unverifiable).",
        },
        authorization_evidence: {
          type: 'object',
          description: "Evidence for the 'attested' modality. Required if modality is not 'autonomous'.",
          properties: {
            instruction: { type: 'string', description: 'What the human instructed (required for attested and verified).' },
            platform: { type: 'string', description: 'Platform that attested or verified the instruction (required for attested and verified).' },
            timestamp: { type: 'string', description: 'ISO 8601 timestamp of when the instruction was given. Auto-set to now if omitted.' },
            user_signature: { type: 'string', description: "Not accepted: the broker can't check a bare signature string, so it refuses 'verified'." },
          },
        },
        context: {
          type: 'object',
          description: 'Optional context stored by the broker with the handshake (e.g., user ID, account reference). It is not shown on the receipt.',
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
            user_signature: { type: 'string', description: "Not accepted: the broker can't check a bare signature string, so it refuses 'verified'." },
          },
        },
      },
      required: ['session_id', 'target_agent_id', 'scope', 'permissions'],
    },
  },
  {
    name: TOOL_NAMES.VERIFY_CONSENT,
    description: `Check whether a specific action is permitted by a consent token before performing it. Call this before taking any scoped action to ensure you're operating within the agreed boundaries.

Returns whether the action is permitted, and if not, why (e.g., action is in the exclusion list, token expired, scope mismatch, an agent was revoked). Consent tokens are bound to the initiator's key: if the initiator sent a presentation proof with the token, pass it as presentation_proof and the broker checks it (a stolen token without the initiator's key fails).`,
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
        presentation_proof: {
          type: 'string',
          description: "Optional: the presentation proof the initiator sent with the token (from its parafe_create_presentation_proof).",
        },
      },
      required: ['consent_token', 'action', 'session_id'],
    },
  },
  {
    name: TOOL_NAMES.RECORD_ACTION,
    description: `Log an action you're performing within an active session. The broker records it on the session and counts it in your reputation signals. It does not appear on the session's signed receipt yet (per-action receipts are planned).

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
    description: `Close an active session and get its signed receipt. The receipt ('receipt' field) is a compact JWS signed by the broker (ES256): who participated, mutual authentication, every consent token issued in the session (scope, permissions, exclusions, authorization modality, how the initiator proved itself), and when. The human's instruction and the handshake context appear only as hashes. It does not list recorded actions yet (per-action receipts are planned). The other fields are a readable copy decoded from the JWS.

Either participant may close; the other one can fetch the same receipt with parafe_get_session_receipt. Anyone holding the JWS can independently verify it against the broker's published keys. It serves as neutral, tamper-proof evidence of the session's trust context.

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
    description: `Verify a receipt's signature to confirm it was genuinely issued by the Parafe broker and has not been tampered with. Use this to independently validate interaction records.

Pass the receipt JWS (the 'receipt' field from parafe_close_session or parafe_get_session_receipt), or the whole object returned by those tools. Receipts from before 2026-09-30 (signed JSON) also verify. Returns whether the signature is valid, whether tampering was detected, and the verified claims.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        receipt: {
          type: ['string', 'object'],
          description: "The receipt JWS string, or the receipt object returned by parafe_close_session / parafe_get_session_receipt.",
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
    description: `Renew an agent's credential. The broker re-issues it when the owner's verification tier has changed (e.g. after email or domain verification), when the credential doesn't show the agent's current owner yet (identity_changed, e.g. after someone claimed it), or when the credential is expired or within 7 days of expiry; otherwise it returns renewed: false.

Credentials expire after 30 days. Renew in the last week to keep trust capabilities uninterrupted.`,
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
    name: TOOL_NAMES.CREATE_CLAIM_LINK,
    description: `Get a claim link for this agent, when it registered without an API key and has no owner. Show the url to the person you act for: they open it, sign in to Parafé (or create an account) and approve, and you become their agent (identity assurance 'claimed', their verification tier). Services that refuse self-registered or unverified agents then accept you. No secret passes through you: the link only works for a signed-in person who approves it.

The link is single use and lasts 30 minutes; a new one replaces the old. A handshake refused for identity or tier (identity_insufficient, tier_insufficient) also returns a claim link. After approval, call parafe_renew_credential so your credential shows it. Fails with already_claimed if you already have an owner.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
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
              minimum_initiator_proof: { type: 'string', enum: ['pop', 'credential'] },
              description: { type: 'string' },
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
    description: `Get the Parafe broker's signing keys (a JWKS). Every Parafe-signed artifact (credential, consent token, receipt) names the key that signed it (kid); with these keys anyone can verify it without calling the broker. The active key is ES256; the Ed25519 key that signed artifacts before 2026-09-30 is listed as retired.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: TOOL_NAMES.VERIFY_CONSENT_LOCALLY,
    description: `Verify a consent token locally against the broker's published keys — no broker round-trip per token (the keys are fetched once and cached). Use this when you need to validate a consent token offline or in a latency-sensitive path.

Returns the token's scope, permissions, exclusions, session, initiator, audience, the key it's bound to, and how the initiator proved itself, or an error if the signature is invalid. Expired tokens return expired: true.

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
          description: "Optional, legacy: the broker's Ed25519 key in base64, for tokens issued before 2026-09-30. Omit it: the broker's JWKS is fetched and cached.",
        },
      },
      required: ['consent_token'],
    },
  },
  {
    name: TOOL_NAMES.GET_AGENT_METRICS,
    description: `Retrieve reputation metrics for a Parafe-registered agent. Returns the raw trust signals that indicate how trustworthy an agent is based on its interaction history: session completion rate, unique counterparties, tenure, handshake success rate, and denied scope requests.

Use this before deciding whether to interact with an agent — especially self_registered agents — to assess their track record. Does not return a score; returns the signals a score would be built from.

Key signals:
- tenure_days: How long the agent has been active
- completion_rate: Ratio of successfully closed sessions to total sessions (0–1)
- unique_counterparties: How many distinct agents this agent has interacted with
- handshake_success_rate: Ratio of successful handshakes to total attempts (0–1)
- denied_scope_requests: How many times this agent's consent token requests were rejected by policy (wrong modality, insufficient assurance, insufficient tier)

Higher tenure, completion rate, counterparty count, and handshake success rate indicate a more trustworthy agent. Higher denied scope requests may indicate an agent repeatedly requesting access it isn't authorized for.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: "Parafe agent ID to get metrics for (starts with 'prf_agent_').",
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: TOOL_NAMES.GET_SESSION_RECEIPT,
    description: `Fetch the signed receipt of a closed session. Either participant can, not only the one that closed it. Use this when the other agent closed the session. Returns the receipt JWS ('receipt') and a readable copy decoded from it, like parafe_close_session. Fails if the session isn't closed yet.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: "Session ID (starts with 'sess_').",
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: TOOL_NAMES.CREATE_PRESENTATION_PROOF,
    description: `Create the presentation proof to send along with a consent token when you present it to the target agent (for example in the Parafe A2A extension's consent data, field 'proof'). Consent tokens are bound to your key; the proof, signed with your private key, shows the target that the token is being presented by its rightful holder. Make a fresh proof for every message.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        consent_token: {
          type: 'string',
          description: 'The consent token you are presenting.',
        },
        message_id: {
          type: 'string',
          description: 'Optional: the ID of the A2A message the token travels in, so the proof only fits that message.',
        },
      },
      required: ['consent_token'],
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
