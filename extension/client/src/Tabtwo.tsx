export default function Tabtwo() {
    function handleClick() {
        console.log(window.parent.document);
    }

    return (
        <div id="tab2" className="tab">
            <p>Tab Two</p>
            <button onClick={handleClick}>Press me</button>
        </div>
    )
}