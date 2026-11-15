let accessToken: string | null = null;

const TOKEN_CHANNEL_NAME = "salonix-auth-token";

interface AccessTokenMessage {
  type: "access-token";
  token: string | null;
}

function isAccessTokenMessage(value: unknown): value is AccessTokenMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "access-token" &&
    "token" in value &&
    (typeof value.token === "string" || value.token === null)
  );
}

function getTokenChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }

  const channel = new BroadcastChannel(TOKEN_CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (isAccessTokenMessage(event.data)) accessToken = event.data.token;
  };
  return channel;
}

let tokenChannel: BroadcastChannel | null = null;

function broadcastAccessToken(token: string | null) {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  tokenChannel ??= getTokenChannel();
  tokenChannel?.postMessage({ type: "access-token", token } satisfies AccessTokenMessage);
}

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
  broadcastAccessToken(token);
}

export function clearAccessToken() {
  setAccessToken(null);
}
