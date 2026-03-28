use lib_repository::Repository;
use log::warn;

use super::module_file::ModuleFile;
use super::module_manifest::{ModuleCommand, ModuleFunction, ModuleWorkflow, ModuleWorkflowTrigger};
use super::module_manifest::ModuleManifest;

pub enum NodeKind {
    Command(ModuleCommand),
    Function(ModuleFunction),
    // Storage(ModuleStorage),
    Workflow(ModuleWorkflow),
    WorkflowTrigger(ModuleWorkflowTrigger),
}

impl NodeKind {
    // TODO: This should receive the &app instance
    pub async fn process<R>(&self, module_name: &str, files: &Vec<ModuleFile>, repository: &R, db_proxy_url: Option<&str>)
    where R: Repository {
        let _result = match self {
            // TODO: pass &app.dbClient
            NodeKind::Command(cmd) => cmd.process().await,
            // TODO: pass &app.repository
            NodeKind::Function(func) => func.process(module_name, files, repository).await,
            // NodeKind::Storage(storage) => storage.process(),
            NodeKind::Workflow(workflow) => workflow.process().await,
            NodeKind::WorkflowTrigger(trigger) => {
                if let Some(url) = db_proxy_url {
                    trigger.process(module_name, url).await
                } else {
                    warn!("DB proxy not configured, skipping trigger registration for {}", trigger.name);
                    Ok(())
                }
            },
        };
    }
}

struct Node<T> {
    value: T,
    next: Option<Box<Node<T>>>,
}

pub struct ModulePlan {
    head: Option<Box<Node<NodeKind>>>,
}

impl ModulePlan {
    pub fn new(maybe_manifest: Option<ModuleManifest>) -> Self {
        let manifest = if let Some(manifest) = maybe_manifest {
            manifest
        } else { 
            // no manifest was provided, create empty plan
            return Self { head: None } 
        };

        // add items to plan in reverse order (LIFO)
        // workflows -> triggers -> commands -> storage -> functions
        let mut instance = Self { head: None };

        for workflow in manifest.workflows {
            instance.push(NodeKind::Workflow(workflow))
        }

        for trigger in manifest.workflow_triggers {
            instance.push(NodeKind::WorkflowTrigger(trigger))
        }

        for command in manifest.commands {
            instance.push(NodeKind::Command(command))
        }

        for function in manifest.functions {
            instance.push(NodeKind::Function(function))
        }

        // instance.push(NodeKind::Storage(manifest.storage));
        
        instance
    }

    fn push(&mut self, value: NodeKind) {
        let node = Box::new(Node {
            value,
            next: self.head.take()
        });
        self.head = Some(node);
    }

    fn pop(&mut self) -> Option<NodeKind> {
        self.head.take().map(|node| {
            self.head = node.next;
            node.value
        })
    }

    pub fn iter(&self) -> Iter {
        Iter {
            current: self.head.as_deref(),
        }
    }
}

impl Drop for ModulePlan {
    fn drop(&mut self) {
        while self.pop().is_some() {}
    }
}

pub struct Iter<'a> {
    current: Option<&'a Node<NodeKind>>,
}

impl<'a> Iterator for Iter<'a> {
    type Item = &'a NodeKind;

    fn next(&mut self) -> Option<Self::Item> {
        self.current.map(|node| {
            self.current = node.next.as_deref();
            &node.value
        })
    }
}