use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("authentication required")]
    Unauthorized,
    #[error("access denied")]
    Forbidden,
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Conflict(String),
    #[error("not found")]
    NotFound,
    #[error("upstream service error")]
    Upstream,
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl ApiError {
    /// Map SQLite unique-constraint violations to a 409 with the given
    /// message; pass every other error through unchanged.
    pub fn conflict_on_unique(err: sqlx::Error, message: &str) -> Self {
        if let sqlx::Error::Database(db_err) = &err
            && db_err.is_unique_violation()
        {
            return Self::Conflict(message.to_string());
        }
        err.into()
    }
}

#[derive(Serialize, ToSchema)]
pub struct ErrorResponse {
    pub error: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Forbidden => StatusCode::FORBIDDEN,
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Upstream => StatusCode::BAD_GATEWAY,
            Self::Sqlx(_) | Self::Other(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = %self, "internal server error");
        }
        let message = if status == StatusCode::INTERNAL_SERVER_ERROR {
            "internal server error".to_string()
        } else {
            self.to_string()
        };
        (status, Json(ErrorResponse { error: message })).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
