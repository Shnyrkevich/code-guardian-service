/** The subset of a Trivy vulnerability entry (Results[].Vulnerabilities[]) that we read. */
export interface TrivyVulnerability {
  VulnerabilityID: string;
  PkgName: string;
  InstalledVersion: string;
  FixedVersion?: string;
  Severity: string;
  Title?: string;
  PrimaryURL?: string;
}
