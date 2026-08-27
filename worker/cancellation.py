"""Define the application-specific exception used to stop cancelled work."""


class JobCancelled(Exception):
    """Raised for expected user cancellation, not an infrastructure failure."""
