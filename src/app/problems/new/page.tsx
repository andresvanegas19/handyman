import Intake from "@/components/intake/intake";
import styles from "@/components/intake/intake-form.module.css";

export default function NewProblemPage() {
  return <div className={styles.screen}>
    <div className={styles.content}>
      <h1 className={styles.heading}>Ready when you are.</h1>
      <Intake/>
    </div>
  </div>;
}
