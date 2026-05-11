import crypto from "node:crypto";

let cachedPrivateKeyPem = null;
let cachedPublicKeyPem = null;

/**
 * 传输层加密：客户端用公钥加密 AppSecret，服务端私钥解密。
 * 生产环境请配置 WECHAT_ACCOUNT_TRANSPORT_RSA_PRIVATE_KEY_PEM（PKCS#8 PEM）。
 * 未配置时在启动时生成临时密钥（仅供开发；重启后需桌面端重新拉取公钥）。
 */
export function ensureWechatAccountTransportKeys() {
  if (cachedPrivateKeyPem) return;

  const raw = process.env.WECHAT_ACCOUNT_TRANSPORT_RSA_PRIVATE_KEY_PEM;
  const pem = typeof raw === "string" ? raw.replace(/\\n/g, "\n").trim() : "";

  if (pem) {
    cachedPrivateKeyPem = pem;
    cachedPublicKeyPem = crypto.createPublicKey(pem).export({ type: "spki", format: "pem" });
    return;
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  cachedPrivateKeyPem = privateKey;
  cachedPublicKeyPem = publicKey;
  console.warn(
    "[wechat-accounts] WECHAT_ACCOUNT_TRANSPORT_RSA_PRIVATE_KEY_PEM 未配置，已使用临时 RSA 密钥（重启后客户端需重新获取公钥）。",
  );
}

export function getWechatAccountTransportPublicKeyPem() {
  ensureWechatAccountTransportKeys();
  return cachedPublicKeyPem;
}

export function decryptWechatAccountAppSecretTransport(base64Cipher) {
  if (!base64Cipher || typeof base64Cipher !== "string") {
    return "";
  }

  const trimmed = base64Cipher.trim();
  if (!trimmed) return "";

  ensureWechatAccountTransportKeys();

  let buf;
  try {
    buf = Buffer.from(trimmed, "base64");
  } catch {
    throw new Error("APP_SECRET_CIPHER_INVALID");
  }

  try {
    const decrypted = crypto.privateDecrypt(
      {
        key: cachedPrivateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      buf,
    );
    return decrypted.toString("utf8");
  } catch {
    throw new Error("APP_SECRET_DECRYPT_FAILED");
  }
}
