use crate::services::module_service::module_manifest::ManifestBackgroundTask;
use chrono::Utc;
use lib_sandbox::models::request::InvokeRequest;
use lib_sandbox::SandboxFactory;
use log::{error, info, warn};
use serde_json::json;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Mutex;
use tokio::task::AbortHandle;

/// Internal host-managed scheduler for module background tasks.
///
/// Registered tasks run on the cron schedule declared in the module manifest.
/// They are completely hidden from users — no workflow rows are created.
/// All tasks for a module are cancelled when the module is unloaded.
pub struct BackgroundTaskScheduler {
    sandbox: SandboxFactory,
    tasks: Mutex<HashMap<String, Vec<AbortHandle>>>,
}

impl BackgroundTaskScheduler {
    pub fn new(sandbox: SandboxFactory) -> Self {
        Self {
            sandbox,
            tasks: Mutex::new(HashMap::new()),
        }
    }

    /// Register background tasks for a module. Replaces any existing tasks
    /// registered under the same module_key (idempotent on re-load).
    pub fn register(&self, module_key: &str, task_defs: &[ManifestBackgroundTask]) {
        // Cancel any previously registered tasks for this module first.
        self.unregister(module_key);

        if task_defs.is_empty() {
            return;
        }

        let mut handles = Vec::with_capacity(task_defs.len());

        for task in task_defs {
            let schedule = match cron::Schedule::from_str(&task.schedule) {
                Ok(s) => s,
                Err(e) => {
                    warn!(
                        "Background task {}/{}: invalid cron expression '{}': {}",
                        module_key, task.id, task.schedule, e
                    );
                    continue;
                }
            };

            let function_id = format!("{}:function:{}", module_key, task.function);
            let sandbox = self.sandbox.clone();
            let task_id = task.id.clone();
            let module_key_owned = module_key.to_string();

            let join_handle = tokio::spawn(async move {
                info!(
                    "Background task started module={} task={} function={}",
                    module_key_owned, task_id, function_id
                );
                loop {
                    let next = match schedule.upcoming(Utc).next() {
                        Some(t) => t,
                        None => {
                            warn!(
                                "Background task {}/{}: no upcoming fire time; stopping",
                                module_key_owned, task_id
                            );
                            break;
                        }
                    };

                    let now = Utc::now();
                    let delay = (next - now).to_std().unwrap_or_default();
                    info!(
                        "Background task {}/{} scheduled next fire at {}",
                        module_key_owned, task_id, next.to_rfc3339()
                    );
                    tokio::time::sleep(delay).await;

                    let fn_id = function_id.clone();
                    let sb = sandbox.clone();
                    let m = module_key_owned.clone();
                    let t = task_id.clone();

                    info!("Background task {}/{} firing", m, t);
                    let fire_start = std::time::Instant::now();

                    // spawn_blocking because Sandbox::invoke drives the QuickJS runtime
                    // synchronously and ReqwestHttpClient::request calls block_on internally.
                    let result = tokio::task::spawn_blocking(move || {
                        let sandbox_instance = sb.create().map_err(|e| e.to_string())?;
                        sandbox_instance
                            .invoke(InvokeRequest {
                                function: fn_id,
                                event: json!({}),
                                user: None,
                                params: json!({}),
                            })
                            .map_err(|e| e.to_string())
                    })
                    .await;

                    let elapsed_ms = fire_start.elapsed().as_millis();
                    match result {
                        Ok(Ok(_)) => {
                            info!(
                                "Background task {}/{} completed in {}ms",
                                m, t, elapsed_ms
                            );
                        }
                        Ok(Err(e)) => {
                            error!(
                                "Background task {}/{} invoke error after {}ms: {}",
                                m, t, elapsed_ms, e
                            );
                        }
                        Err(e) => {
                            error!(
                                "Background task {}/{} spawn error after {}ms: {}",
                                m, t, elapsed_ms, e
                            );
                        }
                    }
                }
            });

            handles.push(join_handle.abort_handle());
        }

        let count = handles.len();
        if count > 0 {
            self.tasks
                .lock()
                .unwrap()
                .insert(module_key.to_string(), handles);
            info!(
                "Registered {} background task(s) for module {}",
                count, module_key
            );
        }
    }

    /// Cancel all background tasks for a module. No-op if none are registered.
    pub fn unregister(&self, module_key: &str) {
        let handles = self.tasks.lock().unwrap().remove(module_key);
        if let Some(handles) = handles {
            let count = handles.len();
            for h in handles {
                h.abort();
            }
            info!(
                "Unregistered {} background task(s) for module {}",
                count, module_key
            );
        }
    }
}
