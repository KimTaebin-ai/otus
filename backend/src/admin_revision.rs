//! Revision-request validation and the state change used by the shared review
//! transaction. The caller owns authorization, locks, idempotency and audit data.

use diesel::prelude::*;
use diesel_async::{AsyncPgConnection, RunQueryDsl};

use crate::cycle;
use crate::domain::{DocType, Status};
use crate::error::AppError;
use crate::models::Submission;
use crate::schema::submissions;

pub struct PreparedRevision {
    pub review_comment: String,
    /// Empty means all required documents of the reviewed submission.
    pub revision_doc_types: Vec<DocType>,
}

/// Normalize the body before computing the review request's idempotency
/// fingerprint. This must not check the cycle: a successful request can still be
/// replayed after the cycle has closed.
pub fn prepare(
    review_comment: Option<&str>,
    revision_doc_types: &[String],
) -> Result<PreparedRevision, AppError> {
    let comment = review_comment.map(str::trim).filter(|c| !c.is_empty());
    let comment = comment.ok_or_else(|| {
        AppError::InvalidRequest("재검토 요청에는 review_comment가 필요합니다.".into())
    })?;
    if comment.chars().count() > 1000 {
        return Err(AppError::InvalidRequest(
            "review_comment는 1000자 이하여야 합니다.".into(),
        ));
    }
    let types = revision_doc_types
        .iter()
        .map(|value| value.parse::<DocType>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| AppError::InvalidRequest("알 수 없는 doc_type입니다.".into()))?;
    Ok(PreparedRevision {
        review_comment: comment.to_owned(),
        revision_doc_types: canonical_doc_types(&types),
    })
}

fn canonical_doc_types(types: &[DocType]) -> Vec<DocType> {
    DocType::ALL
        .iter()
        .copied()
        .filter(|doc_type| types.contains(doc_type))
        .collect()
}

fn requested_documents(
    required: &[Option<DocType>],
    requested: &[DocType],
) -> Result<Vec<DocType>, AppError> {
    let required: Vec<DocType> = required.iter().flatten().copied().collect();
    if !requested.iter().all(|doc_type| required.contains(doc_type)) {
        return Err(AppError::InvalidRequest(
            "revision_doc_types는 이 제출의 서류여야 합니다.".into(),
        ));
    }
    Ok(canonical_doc_types(if requested.is_empty() {
        &required
    } else {
        requested
    }))
}

/// Apply only to the locked, reviewable leaf selected by the shared handler.
/// Ancestors remain resubmitted until a later approval covers the whole chain.
pub async fn apply(
    conn: &mut AsyncPgConnection,
    sub: &Submission,
    request: &PreparedRevision,
) -> Result<(), AppError> {
    let requested = requested_documents(&sub.required_doc_types, &request.revision_doc_types)?;
    // Students cannot upload or finalize supplements after the month's deadline,
    // so a new revision request must follow the same period rule.
    cycle::ensure_open(conn, sub.target_month).await?;
    diesel::update(submissions::table.find(sub.id))
        .set((
            submissions::status.eq(Status::RevisionRequested),
            submissions::review_comment.eq(Some(&request.review_comment)),
            submissions::revision_doc_types.eq(requested.into_iter().map(Some).collect::<Vec<_>>()),
        ))
        .execute(conn)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revision_reason_is_required_after_unicode_whitespace_trim() {
        for comment in [None, Some(""), Some(" \n\t\u{3000}")] {
            assert!(matches!(
                prepare(comment, &[]),
                Err(AppError::InvalidRequest(_))
            ));
        }
        let prepared = prepare(Some("\u{3000}페이지가 흐려요.\n다시 제출해주세요. \n"), &[])
            .ok()
            .unwrap();
        assert_eq!(
            prepared.review_comment,
            "페이지가 흐려요.\n다시 제출해주세요."
        );
    }

    #[test]
    fn revision_reason_limit_counts_unicode_characters_not_bytes() {
        let at_limit = "한".repeat(1000);
        assert!(prepare(Some(&at_limit), &[]).is_ok());
        assert!(prepare(Some(&format!("  {at_limit}\n")), &[]).is_ok());
        let over_limit = "한".repeat(1001);
        assert!(matches!(
            prepare(Some(&over_limit), &[]),
            Err(AppError::InvalidRequest(_))
        ));
    }

    #[test]
    fn document_order_and_duplicates_have_one_canonical_form() {
        let input = ["bankbook", "id_card", "bankbook", "resident_abstract"].map(str::to_owned);
        let prepared = prepare(Some("전체 페이지를 다시 제출해주세요."), &input)
            .ok()
            .unwrap();
        assert_eq!(
            prepared.revision_doc_types,
            vec![
                DocType::IdCard,
                DocType::ResidentAbstract,
                DocType::Bankbook
            ]
        );
    }

    #[test]
    fn unknown_document_types_are_rejected() {
        for invalid in ["unknown", "", " bankbook", "BANKBOOK"] {
            assert!(matches!(
                prepare(Some("사유"), &[invalid.to_owned()]),
                Err(AppError::InvalidRequest(_))
            ));
        }
    }

    #[test]
    fn empty_document_selection_means_the_reviewed_submissions_documents() {
        let initial = DocType::ALL.iter().copied().map(Some).collect::<Vec<_>>();
        assert_eq!(
            requested_documents(&initial, &[]).ok().unwrap(),
            DocType::ALL
        );
        // A later supplement may require only one of the original four files.
        assert_eq!(
            requested_documents(&[Some(DocType::Bankbook)], &[])
                .ok()
                .unwrap(),
            vec![DocType::Bankbook]
        );
    }

    #[test]
    fn selection_cannot_request_documents_outside_the_current_submission() {
        let required = [Some(DocType::EmploymentInsurance)];
        assert!(matches!(
            requested_documents(&required, &[DocType::Bankbook]),
            Err(AppError::InvalidRequest(_))
        ));
        assert_eq!(
            requested_documents(&required, &[DocType::EmploymentInsurance])
                .ok()
                .unwrap(),
            vec![DocType::EmploymentInsurance]
        );
    }
}
