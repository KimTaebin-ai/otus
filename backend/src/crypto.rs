//! Field-level encryption for sensitive columns (PRD: 계좌 = 민감, 필드 단위 암호화).
//!
//! AES-256-GCM with a random 96-bit nonce per value, stored as `nonce || ciphertext || tag`.
//! The associated data names the column and the owning row (e.g. `bank_account:42`), so a
//! ciphertext copied onto another user's row fails to decrypt. The key comes from
//! BANK_ACCOUNT_KEY(_FILE), never from the database.

use aes_gcm::aead::{Aead, Generate, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{Context, anyhow, bail};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;

const NONCE_LEN: usize = 12;

pub struct FieldCipher {
    key_id: i16,
    cipher: Aes256Gcm,
}

impl FieldCipher {
    /// `key_b64` is 32 random bytes in base64 (`openssl rand -base64 32`); `name` is the
    /// variable it came from, for error messages.
    pub fn new(name: &str, key_id: i16, key_b64: &str) -> anyhow::Result<Self> {
        let key = zeroize::Zeroizing::new(
            STANDARD
                .decode(key_b64.trim())
                .with_context(|| format!("{name} is not valid base64"))?,
        );
        if key.len() != 32 {
            bail!("{name} must be 32 bytes, got {}", key.len());
        }
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| anyhow!("invalid key length"))?;
        Ok(Self { key_id, cipher })
    }

    pub fn key_id(&self) -> i16 {
        self.key_id
    }

    pub fn encrypt(&self, plaintext: &[u8], aad: &str) -> anyhow::Result<Vec<u8>> {
        let nonce = Nonce::generate();
        let ciphertext = self
            .cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: plaintext,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| anyhow!("encryption failed"))?;
        let mut out = nonce.to_vec();
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    /// Stored files are decrypted to verify them; account numbers only for the future
    /// accountant view (students only ever see masks).
    pub fn decrypt(&self, key_id: i16, data: &[u8], aad: &str) -> anyhow::Result<Vec<u8>> {
        if key_id != self.key_id {
            bail!("no key loaded for key_id {key_id}");
        }
        if data.len() < NONCE_LEN {
            bail!("ciphertext too short");
        }
        let (nonce, ciphertext) = data.split_at(NONCE_LEN);
        let nonce = Nonce::try_from(nonce).map_err(|_| anyhow!("bad nonce"))?;
        self.cipher
            .decrypt(
                &nonce,
                Payload {
                    msg: ciphertext,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| anyhow!("decryption failed (wrong key, row, or tampered data)"))
    }
}

pub fn bank_account_aad(user_id: i64) -> String {
    format!("bank_account:{user_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cipher() -> FieldCipher {
        FieldCipher::new("TEST_KEY", 1, &STANDARD.encode([7u8; 32])).unwrap()
    }

    #[test]
    fn round_trip_with_fresh_nonces() {
        let c = cipher();
        let a = c.encrypt(b"110123456789", &bank_account_aad(1)).unwrap();
        let b = c.encrypt(b"110123456789", &bank_account_aad(1)).unwrap();
        assert_ne!(a, b, "same plaintext must not give the same ciphertext");
        assert!(!a.windows(12).any(|w| w == b"110123456789"));
        assert_eq!(
            c.decrypt(1, &a, &bank_account_aad(1)).unwrap(),
            b"110123456789"
        );
    }

    #[test]
    fn rejects_other_rows_tampering_and_wrong_keys() {
        let c = cipher();
        let mut data = c.encrypt(b"110123456789", &bank_account_aad(1)).unwrap();
        assert!(
            c.decrypt(1, &data, &bank_account_aad(2)).is_err(),
            "moved to another user"
        );
        assert!(
            c.decrypt(2, &data, &bank_account_aad(1)).is_err(),
            "unknown key id"
        );
        let other = FieldCipher::new("TEST_KEY", 1, &STANDARD.encode([8u8; 32])).unwrap();
        assert!(
            other.decrypt(1, &data, &bank_account_aad(1)).is_err(),
            "wrong key"
        );
        *data.last_mut().unwrap() ^= 1;
        assert!(
            c.decrypt(1, &data, &bank_account_aad(1)).is_err(),
            "tampered"
        );
    }

    #[test]
    fn key_must_be_32_bytes_of_base64() {
        assert!(FieldCipher::new("TEST_KEY", 1, "not base64!").is_err());
        assert!(FieldCipher::new("TEST_KEY", 1, &STANDARD.encode([0u8; 16])).is_err());
    }
}
