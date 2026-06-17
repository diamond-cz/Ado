use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Bad path: {0}")]
    BadPath(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Other: {0}")]
    Other(String),
}

impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}

pub type CmdResult<T> = Result<T, String>;

pub fn map_err<T, E: std::fmt::Display>(r: Result<T, E>) -> CmdResult<T> {
    r.map_err(|e| e.to_string())
}
