export default function Header({ onClick }) {
    return (
        <div id="headingContainer">
            <div className="heading" onClick={() => onClick(0)}>Commands</div>
            <div className="heading" onClick={() => onClick(1)}>Sound Alerts</div>
            <div className="heading" onClick={() => onClick(2)}>Rewards</div>
        </div>
    )
}