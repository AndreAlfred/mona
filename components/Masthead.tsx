import Link from "next/link";
import { RequestsLink } from "./RequestsLink";
import styles from "./Masthead.module.css";

export function Masthead() {
  return (
    <header className={styles.bar}>
      <Link href="/" className={styles.mark} aria-label="Mona, home">
        Mona
      </Link>
      <nav className={`${styles.nav} smallcaps`}>
        <Link href="/collection">Collection</Link>
        <Link href="/history">History</Link>
        <RequestsLink />
      </nav>
    </header>
  );
}
