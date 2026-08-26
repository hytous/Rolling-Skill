import type {Translate} from "../locale"

export interface RuntimeDescriptor {
    runtimeId: string
    providerId: string
    displayName: string
    version: string
    executablePath: string
    label: string
    efforts?: string[]
}

export function RuntimeSelect({
    t,
    runtimes,
    value,
    onChange,
    label,
}: {
    t: Translate
    runtimes: RuntimeDescriptor[]
    value: string
    onChange: (runtimeId: string) => void
    label: string
}) {
    return (
        <fieldset className="rolling-skill-runtime-select">
            <legend>{label}</legend>
            <div className="rolling-skill-runtime-list">
                {runtimes.map((runtime) => (
                    <label className="rolling-skill-runtime-option" key={runtime.runtimeId}>
                        <input
                            type="radio"
                            name={label}
                            value={runtime.runtimeId}
                            checked={value === runtime.runtimeId}
                            onChange={() => onChange(runtime.runtimeId)}
                        />
                        <span>
                            <strong>{runtime.displayName} {runtime.version}</strong>
                            <code>{runtime.executablePath}</code>
                        </span>
                    </label>
                ))}
                {runtimes.length === 0 ? <p>{t("noRuntimes")}</p> : null}
            </div>
        </fieldset>
    )
}
