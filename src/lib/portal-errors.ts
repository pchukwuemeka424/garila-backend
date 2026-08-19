export class AppError extends Error {
	constructor(
		message: string,
		public readonly statusCode = 500,
		public readonly code = "INTERNAL_ERROR",
		public readonly details?: unknown,
	) {
		super(message);
		this.name = new.target.name;
	}
}

export class NotFoundError extends AppError {
	constructor(message = "Resource not found") {
		super(message, 404, "NOT_FOUND");
	}
}

export class ForbiddenError extends AppError {
	constructor(message = "You do not have permission to perform this action") {
		super(message, 403, "FORBIDDEN");
	}
}

export class ConflictError extends AppError {
	constructor(message = "Resource conflicts with existing data") {
		super(message, 409, "CONFLICT");
	}
}

export class ValidationError extends AppError {
	constructor(message = "Validation failed", details?: unknown) {
		super(message, 422, "VALIDATION_ERROR", details);
	}
}

export class UnauthorizedError extends AppError {
	constructor(message = "Authentication is required") {
		super(message, 401, "UNAUTHORIZED");
	}
}
