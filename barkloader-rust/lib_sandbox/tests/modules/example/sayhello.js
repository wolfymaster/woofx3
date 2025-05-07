function foo(args) {
    return { response: "Hello " + (args.name || "World") };
}

function main(args) {
    return foo(args);
}
