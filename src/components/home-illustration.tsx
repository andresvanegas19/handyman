import HomeMascot from "./home-mascot";

export default function HomeIllustration() {
  return <div className="home-illustration">
    <div className="illustration-orbit"/>
    <HomeMascot/>
    <div className="visual-label label-top"><span className="label-icon">✦</span><div>A little guidance.<small>A lot more confidence.</small></div></div>
    <div className="visual-label label-bottom"><span className="status-dot"/><div>Your next small fix starts here.</div></div>
    <span className="visual-caption">A happier home, one fix at a time.</span>
  </div>;
}
