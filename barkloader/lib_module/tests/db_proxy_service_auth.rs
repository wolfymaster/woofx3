//! The shared db-proxy client attaches the service token to every request.
//!
//! This lives in its own test binary because `configure_service_auth` sets a
//! process-wide client exactly once.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::thread;

/// Accepts one HTTP request, answers it with an empty JSON object, and
/// returns the request's header lines.
fn serve_one_request(listener: TcpListener) -> thread::JoinHandle<Vec<String>> {
    thread::spawn(move || {
        let (stream, _) = listener.accept().expect("accept");
        let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));
        let mut headers = Vec::new();
        let mut content_length = 0usize;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).expect("read header line");
            let line = line.trim_end().to_string();
            if line.is_empty() {
                break;
            }
            if let Some((name, value)) = line.split_once(':')
                && name.eq_ignore_ascii_case("content-length")
            {
                content_length = value.trim().parse().expect("content length");
            }
            headers.push(line);
        }
        let mut body = vec![0u8; content_length];
        std::io::Read::read_exact(&mut reader, &mut body).expect("read body");
        let mut stream = stream;
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
            )
            .expect("write response");
        headers
    })
}

#[tokio::test]
async fn test_db_proxy_client_sends_the_service_token() {
    lib_module::db_proxy::configure_service_auth(" barkloader-service-token ")
        .expect("configure service auth");
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let base_url = format!("http://{}", listener.local_addr().expect("local addr"));
    let server = serve_one_request(listener);

    lib_module::db_proxy::delete_triggers_by_module_id(&base_url, "module-1", "key-1")
        .await
        .expect("request succeeds");

    let headers = server.join().expect("server thread");
    assert!(
        headers
            .iter()
            .any(|line| line.eq_ignore_ascii_case("authorization: Bearer barkloader-service-token")),
        "no service token in {headers:?}"
    );
    assert!(
        lib_module::db_proxy::configure_service_auth("another-token").is_err(),
        "a second configuration must be refused"
    );
}
