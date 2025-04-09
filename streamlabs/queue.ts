export default class Queue<T> {
    queue: T[];

    constructor() {
        this.queue = new Array(10);
    }

    get(idx: number) {
        return this.queue[idx];
    }

    insert(idx: number, item: T) {
        this.queue[idx] = item;
    }
}