// @generated automatically by Diesel CLI.

diesel::table! {
    admin_notice_events (id) {
        id -> Int8,
        notice_id -> Int8,
        recipient_id -> Nullable<Int8>,
        actor_user_id -> Nullable<Int8>,
        event -> Text,
        detail -> Text,
        created_at -> Timestamptz,
    }
}

diesel::table! {
    admin_notice_operations (idempotency_key) {
        idempotency_key -> Uuid,
        actor_user_id -> Int8,
        operation -> Text,
        request_hash -> Text,
        notice_id -> Int8,
        response_json -> Text,
        created_at -> Timestamptz,
    }
}

diesel::table! {
    admin_notice_recipients (id) {
        id -> Int8,
        notice_id -> Int8,
        user_id -> Int8,
        notification_id -> Nullable<Int8>,
        email_recipient -> Nullable<Text>,
        email_status -> Text,
        email_attempts -> Int4,
        claim_token -> Nullable<Uuid>,
        claimed_at -> Nullable<Timestamptz>,
        email_sent_at -> Nullable<Timestamptz>,
        last_error_code -> Nullable<Text>,
        message_id -> Uuid,
        created_at -> Timestamptz,
    }
}

diesel::table! {
    admin_notices (id) {
        id -> Int8,
        target_month -> Date,
        actor_user_id -> Int8,
        actor_role -> Text,
        employed_excluded -> Int8,
        created_at -> Timestamptz,
        audience -> Text,
        channel -> Text,
        audiences -> Array<Nullable<Text>>,
        title -> Nullable<Text>,
        body -> Nullable<Text>,
    }
}

diesel::table! {
    admin_review_decisions (id) {
        id -> Int8,
        submission_id -> Uuid,
        event_id -> Int8,
        actor_user_id -> Int8,
        actor_name -> Text,
        actor_role -> Text,
        decision -> Text,
        review_comment -> Nullable<Text>,
        revision_doc_types -> Array<Nullable<Text>>,
        idempotency_key -> Uuid,
        request_fingerprint -> Text,
        response_json -> Text,
        created_at -> Timestamptz,
    }
}

diesel::table! {
    admin_review_event_links (event_id) {
        event_id -> Int8,
        decision_id -> Int8,
    }
}

diesel::table! {
    archive_export_events (id) {
        id -> Int8,
        job_id -> Uuid,
        actor_user_id -> Int8,
        action -> Text,
        created_at -> Timestamptz,
    }
}

diesel::table! {
    archive_export_jobs (id) {
        id -> Uuid,
        created_by -> Int8,
        target_month -> Date,
        idempotency_key -> Uuid,
        request_hash -> Bytea,
        snapshot -> Text,
        status -> Text,
        student_count -> Int8,
        pdf_count -> Int8,
        created_at -> Timestamptz,
        completed_at -> Nullable<Timestamptz>,
        expires_at -> Nullable<Timestamptz>,
        key_id -> Nullable<Int2>,
        size_bytes -> Nullable<Int8>,
        sha256 -> Nullable<Bytea>,
    }
}

diesel::table! {
    bank_account_changes (id) {
        id -> Int8,
        user_id -> Int8,
        bank -> Text,
        account_number_enc -> Bytea,
        key_id -> Int2,
        account_last4 -> Text,
        status -> Text,
        requested_at -> Timestamptz,
        decided_at -> Nullable<Timestamptz>,
        decided_by -> Nullable<Int8>,
        decision_note -> Nullable<Text>,
        bankbook_file_id -> Nullable<Uuid>,
        bankbook_original_name -> Nullable<Text>,
        bankbook_size_bytes -> Nullable<Int8>,
        bankbook_sha256 -> Nullable<Bytea>,
        bankbook_key_id -> Nullable<Int2>,
    }
}

diesel::table! {
    cycle_changes (id) {
        id -> Int8,
        target_month -> Date,
        version -> Int8,
        actor_user_id -> Int8,
        actor_name -> Text,
        actor_role -> Text,
        previous_opens_at -> Nullable<Timestamptz>,
        previous_closes_at -> Nullable<Timestamptz>,
        opens_at -> Timestamptz,
        closes_at -> Timestamptz,
        created_at -> Timestamptz,
    }
}

diesel::table! {
    cycles (target_month) {
        target_month -> Date,
        opens_at -> Timestamptz,
        closes_at -> Timestamptz,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
        version -> Int8,
    }
}

diesel::table! {
    file_access_log (id) {
        id -> Int8,
        file_id -> Uuid,
        accessed_by -> Int8,
        owner_id -> Int8,
        access_basis -> Text,
        accessed_at -> Timestamptz,
        purpose -> Text,
        export_job_id -> Nullable<Uuid>,
    }
}

diesel::table! {
    notifications (id) {
        id -> Int8,
        user_id -> Int8,
        kind -> Text,
        data -> Text,
        created_at -> Timestamptz,
        read_at -> Nullable<Timestamptz>,
    }
}

diesel::table! {
    sessions (id_hash) {
        id_hash -> Bytea,
        user_id -> Int8,
        csrf_hash -> Bytea,
        created_at -> Timestamptz,
        last_seen_at -> Timestamptz,
        expires_at -> Timestamptz,
    }
}

diesel::table! {
    submission_events (id) {
        id -> Int8,
        submission_id -> Uuid,
        from_status -> Nullable<Text>,
        to_status -> Text,
        actor_user_id -> Int8,
        idempotency_key -> Nullable<Uuid>,
        note -> Nullable<Text>,
        created_at -> Timestamptz,
    }
}

diesel::table! {
    submission_files (id) {
        id -> Uuid,
        submission_id -> Uuid,
        doc_type -> Text,
        original_name -> Text,
        size_bytes -> Int8,
        sha256 -> Bytea,
        superseded_by -> Nullable<Uuid>,
        created_at -> Timestamptz,
        key_id -> Nullable<Int2>,
    }
}

diesel::table! {
    submissions (id) {
        id -> Uuid,
        user_id -> Int8,
        kind -> Text,
        target_month -> Date,
        parent_id -> Nullable<Uuid>,
        status -> Text,
        submitted_at -> Nullable<Timestamptz>,
        review_comment -> Nullable<Text>,
        required_doc_types -> Array<Nullable<Text>>,
        revision_doc_types -> Array<Nullable<Text>>,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
    }
}

diesel::table! {
    time_requirements (id) {
        id -> Int8,
        user_id -> Int8,
        target_month -> Date,
        recognized_seconds -> Int8,
        as_of -> Timestamptz,
        result_status -> Nullable<Text>,
        tier -> Nullable<Text>,
        decided_at -> Nullable<Timestamptz>,
        final_status -> Text,
        final_amount -> Nullable<Int8>,
        final_decided_at -> Nullable<Timestamptz>,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
    }
}

diesel::table! {
    users (id) {
        id -> Int8,
        intra_id -> Nullable<Int8>,
        login -> Text,
        display_name -> Text,
        role -> Text,
        is_demo -> Bool,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
        employed -> Bool,
        employment_updated_at -> Nullable<Timestamptz>,
        ordinal -> Nullable<Text>,
        ko_name -> Nullable<Text>,
        date_of_birth -> Nullable<Date>,
    }
}

diesel::joinable!(admin_notice_events -> admin_notice_recipients (recipient_id));
diesel::joinable!(admin_notice_events -> admin_notices (notice_id));
diesel::joinable!(admin_notice_events -> users (actor_user_id));
diesel::joinable!(admin_notice_operations -> admin_notices (notice_id));
diesel::joinable!(admin_notice_operations -> users (actor_user_id));
diesel::joinable!(admin_notice_recipients -> admin_notices (notice_id));
diesel::joinable!(admin_notice_recipients -> notifications (notification_id));
diesel::joinable!(admin_notice_recipients -> users (user_id));
diesel::joinable!(admin_notices -> users (actor_user_id));
diesel::joinable!(admin_review_decisions -> submission_events (event_id));
diesel::joinable!(admin_review_decisions -> submissions (submission_id));
diesel::joinable!(admin_review_decisions -> users (actor_user_id));
diesel::joinable!(admin_review_event_links -> admin_review_decisions (decision_id));
diesel::joinable!(admin_review_event_links -> submission_events (event_id));
diesel::joinable!(archive_export_events -> archive_export_jobs (job_id));
diesel::joinable!(archive_export_events -> users (actor_user_id));
diesel::joinable!(archive_export_jobs -> users (created_by));
diesel::joinable!(cycle_changes -> cycles (target_month));
diesel::joinable!(cycle_changes -> users (actor_user_id));
diesel::joinable!(file_access_log -> archive_export_jobs (export_job_id));
diesel::joinable!(notifications -> users (user_id));
diesel::joinable!(sessions -> users (user_id));
diesel::joinable!(submission_events -> submissions (submission_id));
diesel::joinable!(submission_events -> users (actor_user_id));
diesel::joinable!(submission_files -> submissions (submission_id));
diesel::joinable!(submissions -> users (user_id));
diesel::joinable!(time_requirements -> users (user_id));

diesel::allow_tables_to_appear_in_same_query!(
    admin_notice_events,
    admin_notice_operations,
    admin_notice_recipients,
    admin_notices,
    admin_review_decisions,
    admin_review_event_links,
    archive_export_events,
    archive_export_jobs,
    bank_account_changes,
    cycle_changes,
    cycles,
    file_access_log,
    notifications,
    sessions,
    submission_events,
    submission_files,
    submissions,
    time_requirements,
    users,
);
