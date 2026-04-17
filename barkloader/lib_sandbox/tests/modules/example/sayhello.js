function main(ctx) {
    var name = (ctx.event && ctx.event.name) ? ctx.event.name : "World";
    return { response: "Hello " + name };
}
