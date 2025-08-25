use super::module_service::ModuleService;
use super::module_manifest::{ModuleCommand, ModuleFunction, ModuleStorage, ModuleWorkflow};
use super::module_manifest::ModuleManifest;
 
pub enum NodeKind {
    Command(ModuleCommand),
    Function(ModuleFunction),
    Storage(ModuleStorage),
    Workflow(ModuleWorkflow),
}

impl NodeKind {
    pub fn process(&self, _module: &ModuleService) {
        match self {
            NodeKind::Command(cmd) => cmd.process(),
            NodeKind::Function(func) => func.process(),
            NodeKind::Storage(storage) => storage.process(),
            NodeKind::Workflow(workflow) => workflow.process(),
        }
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
        // workflows -> commands -> storage -> functions
        let mut instance = Self { head: None };

        for workflow in manifest.workflows {
            instance.push(NodeKind::Workflow(workflow))    
        }
        
        for command in manifest.commands {
            instance.push(NodeKind::Command(command))
        }

        for function in manifest.functions {
            instance.push(NodeKind::Function(function))
        }
        
        instance.push(NodeKind::Storage(manifest.storage));
        
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