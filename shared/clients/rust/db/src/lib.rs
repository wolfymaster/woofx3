pub mod db {
    pub mod application {
        include!("application/application.rs");
    }

    pub mod command {
        include!("command/command.rs");
    }

    pub mod common {
        include!("common/common.rs");
    }
}
