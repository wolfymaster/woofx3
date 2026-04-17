use actix_web::{error, http::StatusCode, HttpResponse};
use serde::Serialize;
use std::fmt;

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    code: String,
    message: String,
}

#[allow(dead_code)]
#[derive(Debug)]
pub enum AppError {
    FileNotFound(String),
    InvalidFile(String),
    StorageError(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FileNotFound(id) => write!(f, "File not found: {}", id),
            Self::InvalidFile(msg) => write!(f, "Invalid file: {}", msg),
            Self::StorageError(msg) => write!(f, "Storage error: {}", msg),
        }
    }
}

impl error::ResponseError for AppError {
    fn status_code(&self) -> StatusCode {
        match self {
            Self::FileNotFound(_) => StatusCode::NOT_FOUND,
            Self::InvalidFile(_) => StatusCode::BAD_REQUEST,
            Self::StorageError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn error_response(&self) -> HttpResponse {
        let status = self.status_code();
        let error_code = match self {
            Self::FileNotFound(_) => "file_not_found",
            Self::InvalidFile(_) => "invalid_file",
            Self::StorageError(_) => "storage_error",
        };
        
        HttpResponse::build(status).json(ErrorResponse {
            code: error_code.to_string(),
            message: self.to_string(),
        })
    }
}