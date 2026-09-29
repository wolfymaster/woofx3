pub mod db {
    pub mod command {
        include!("command/command.rs");
    }

    pub mod common {
        include!("common/common.rs");
    }

    pub mod workflow {
        include!("workflow/workflow.rs");
    }
}

pub mod storage {
    pub mod storage {
        include!("storage/storage.rs");
    }
}
