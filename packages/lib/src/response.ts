export function json<T>(body: T): { statusCode: 200; body: T; headers: { "Content-Type": "application/json" } };
export function json<T, CT extends number>(body: T, status: CT): { statusCode: CT; body: T; headers: { "Content-Type": "application/json" } };

export function json<T, CT extends number = 200>(
    body: T,
    status?: CT
): {statusCode: CT | 200; body: T; headers: { "Content-Type": "application/json" } } {
    const statusCode = status ?? 200
    return {
        statusCode,
        body,
        headers: {
            "Content-Type": "application/json",
        },
    }
}
