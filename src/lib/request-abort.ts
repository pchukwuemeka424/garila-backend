import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Abort only when the client disconnects mid-handler.
 * Do not use request.raw "close"/"destroyed" after the body is parsed — that fires
 * when the POST is fully received and would cancel outline/ideas generation.
 */
export function abortSignalFromRequest(request: FastifyRequest, reply: FastifyReply): AbortSignal {
	const controller = new AbortController();
	const abort = () => {
		if (!controller.signal.aborted) controller.abort();
	};

	request.raw.once("aborted", () => {
		if (!reply.sent) abort();
	});
	reply.raw.once("close", () => {
		if (!reply.sent && !reply.raw.writableEnded) abort();
	});

	return controller.signal;
}
