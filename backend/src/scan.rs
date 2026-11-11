//! Malware scanning of uploads with ClamAV (clamd's INSTREAM protocol over TCP).
//!
//! Every uploaded PDF is scanned in memory before it's encrypted and stored. Scanning fails
//! closed: if clamd can't be reached or answers anything unexpected, the upload is
//! rejected (503), never stored unscanned.

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

const CHUNK: usize = 64 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// a 20 MiB PDF scans in well under this
const SCAN_TIMEOUT: Duration = Duration::from_secs(60);
/// replies are short ("stream: OK", "stream: <signature> FOUND")
const MAX_REPLY: usize = 1024;

pub enum Verdict {
    Clean,
    Infected(String),
}

pub struct Scanner {
    addr: String,
}

impl Scanner {
    pub fn new(addr: String) -> Self {
        Self { addr }
    }

    async fn connect(&self) -> anyhow::Result<TcpStream> {
        Ok(timeout(CONNECT_TIMEOUT, TcpStream::connect(&self.addr)).await??)
    }

    /// Sends `command` (null-terminated "z" form) and `body`, returns clamd's reply.
    async fn request(
        &self,
        command: &[u8],
        body: impl AsyncFnOnce(&mut TcpStream) -> std::io::Result<()>,
    ) -> anyhow::Result<String> {
        let mut stream = self.connect().await?;
        let exchange = async {
            stream.write_all(command).await?;
            body(&mut stream).await?;
            stream.flush().await?;
            let mut reply = Vec::new();
            let mut buf = [0u8; 256];
            loop {
                let n = stream.read(&mut buf).await?;
                if n == 0 {
                    break;
                }
                reply.extend_from_slice(&buf[..n]);
                if reply.contains(&0) || reply.len() > MAX_REPLY {
                    break;
                }
            }
            std::io::Result::Ok(reply)
        };
        let reply = timeout(SCAN_TIMEOUT, exchange).await??;
        let end = reply.iter().position(|&b| b == 0).unwrap_or(reply.len());
        Ok(String::from_utf8_lossy(&reply[..end]).trim().to_owned())
    }

    pub async fn scan(&self, data: &[u8]) -> anyhow::Result<Verdict> {
        let reply = self
            .request(b"zINSTREAM\0", async |stream| {
                for chunk in data.chunks(CHUNK) {
                    stream
                        .write_all(&(chunk.len() as u32).to_be_bytes())
                        .await?;
                    stream.write_all(chunk).await?;
                }
                stream.write_all(&0u32.to_be_bytes()).await
            })
            .await?;
        parse_reply(&reply)
    }

    /// clamd answers PING once its signatures are loaded.
    pub async fn ready(&self) -> bool {
        matches!(
            self.request(b"zPING\0", async |_| Ok(())).await.as_deref(),
            Ok("PONG")
        )
    }
}

fn parse_reply(reply: &str) -> anyhow::Result<Verdict> {
    let result = reply.strip_prefix("stream: ").unwrap_or(reply);
    if result == "OK" {
        Ok(Verdict::Clean)
    } else if let Some(signature) = result.strip_suffix(" FOUND") {
        Ok(Verdict::Infected(signature.to_owned()))
    } else {
        // includes "INSTREAM size limit exceeded. ERROR" and every other error
        anyhow::bail!("unexpected clamd reply: {reply:?}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replies() {
        assert!(matches!(parse_reply("stream: OK"), Ok(Verdict::Clean)));
        assert!(matches!(
            parse_reply("stream: Eicar-Test-Signature FOUND"),
            Ok(Verdict::Infected(s)) if s == "Eicar-Test-Signature"
        ));
        assert!(parse_reply("INSTREAM size limit exceeded. ERROR").is_err());
        assert!(parse_reply("").is_err());
    }
}
