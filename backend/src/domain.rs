//! Enum values shared with api.md, stored as TEXT (with CHECK constraints) in Postgres.

use std::io::Write;

use diesel::deserialize::{self, FromSql, FromSqlRow};
use diesel::expression::AsExpression;
use diesel::pg::{Pg, PgValue};
use diesel::serialize::{self, IsNull, Output, ToSql};
use diesel::sql_types::Text;
use serde::Serialize;

macro_rules! text_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident => $s:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, AsExpression, FromSqlRow)]
        #[diesel(sql_type = Text)]
        pub enum $name {
            $(#[serde(rename = $s)] $variant),+
        }

        impl $name {
            #[allow(dead_code)]
            pub const ALL: &[Self] = &[$(Self::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $s),+
                }
            }
        }

        impl std::str::FromStr for $name {
            type Err = String;

            fn from_str(s: &str) -> Result<Self, String> {
                match s {
                    $($s => Ok(Self::$variant),)+
                    _ => Err(format!("unknown {} {s:?}", stringify!($name))),
                }
            }
        }

        impl ToSql<Text, Pg> for $name {
            fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
                out.write_all(self.as_str().as_bytes())?;
                Ok(IsNull::No)
            }
        }

        impl FromSql<Text, Pg> for $name {
            fn from_sql(value: PgValue<'_>) -> deserialize::Result<Self> {
                Ok(std::str::from_utf8(value.as_bytes())?.parse()?)
            }
        }
    };
}

text_enum!(Kind {
    Initial => "initial",
    Monthly => "monthly",
    Supplement => "supplement",
});

text_enum!(Status {
    Draft => "draft",
    PendingReview => "pending_review",
    Approved => "approved",
    RevisionRequested => "revision_requested",
    Resubmitted => "resubmitted",
});

text_enum!(Tier {
    Tier1 => "tier_1",
    Tier2 => "tier_2",
});

text_enum!(
    #[derive(serde::Deserialize)]
    NoticeAudience {
        Unsubmitted => "unsubmitted",
        Under40 => "under_40",
        Hours40To80 => "hours_40_80",
        AtLeast80 => "at_least_80",
        Eligible => "eligible",
        Employed => "employed",
        All => "all",
    }
);

impl NoticeAudience {
    pub fn is_unsubmitted(&self) -> bool {
        *self == Self::Unsubmitted
    }

    pub fn study_hours(self) -> Option<u8> {
        match self {
            Self::Unsubmitted | Self::Eligible | Self::Employed | Self::All => None,
            Self::Under40 => Some(0),
            Self::Hours40To80 => Some(40),
            Self::AtLeast80 => Some(80),
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Unsubmitted => "미제출",
            Self::Under40 => "40시간 미만",
            Self::Hours40To80 => "40시간 이상 80시간 미만",
            Self::AtLeast80 => "80시간 이상",
            Self::Eligible => "수령 대상자 · 40시간 이상",
            Self::Employed => "취업자",
            Self::All => "전체 학생",
        }
    }
}

text_enum!(Role {
    Student => "student",
    Operator => "operator",
    Accountant => "accountant",
    Admin => "admin",
});

text_enum!(
    #[derive(serde::Deserialize)]
    NoticeChannel {
        Service => "service",
        Email => "email",
        Both => "both",
    }
);

impl NoticeChannel {
    pub fn service(self) -> bool {
        self != Self::Email
    }
    pub fn email(self) -> bool {
        self != Self::Service
    }
    pub fn is_both(&self) -> bool {
        *self == Self::Both
    }
}

impl Role {
    /// Staff who may call `/api/admin/*` (FE hiding is never the check).
    pub fn is_staff(self) -> bool {
        matches!(self, Self::Operator | Self::Accountant | Self::Admin)
    }
    /// Reviewing submissions (queue, approve, request revision): operator + accountant.
    /// `admin` does not review. Students never do.
    pub fn can_view_originals(self) -> bool {
        matches!(self, Self::Operator | Self::Accountant)
    }
    /// Downloading a PDF through `GET /api/files/{id}`: every staff role. Students open only
    /// their own (checked by owner id). The role split is expected to be tightened later.
    pub fn can_download_files(self) -> bool {
        self.is_staff()
    }
}

text_enum!(DocType {
    IdCard => "id_card",
    ResidentAbstract => "resident_abstract",
    Bankbook => "bankbook",
    EmploymentInsurance => "employment_insurance",
});

impl DocType {
    pub fn label(self) -> &'static str {
        match self {
            Self::IdCard => "신분증",
            Self::ResidentAbstract => "주민등록초본",
            Self::Bankbook => "통장사본",
            Self::EmploymentInsurance => "고용보험가입내역서",
        }
    }
}

/// TEXT[] columns come back as Vec<Option<_>> because Postgres array elements are nullable.
pub fn non_null<T>(v: Vec<Option<T>>) -> Vec<T> {
    v.into_iter().flatten().collect()
}

#[cfg(test)]
mod role_tests {
    use super::Role;
    #[test]
    fn role_matrix() {
        assert!(!Role::Student.is_staff() && !Role::Student.can_view_originals());
        assert!(Role::Operator.is_staff() && Role::Operator.can_view_originals());
        assert!(Role::Accountant.is_staff() && Role::Accountant.can_view_originals());
        // admin may download PDFs but does not review
        assert!(Role::Admin.is_staff() && !Role::Admin.can_view_originals());
        assert!(Role::Admin.can_download_files() && Role::Operator.can_download_files());
        assert!(!Role::Student.can_download_files());
        assert_eq!("operator".parse::<Role>(), Ok(Role::Operator));
        assert!("ops".parse::<Role>().is_err());
    }
}
