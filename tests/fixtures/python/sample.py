"""
Sample Python file for testing the parser
"""

from typing import Optional, List, Dict, TypeVar, Generic
from abc import ABC, abstractmethod
from dataclasses import dataclass
import asyncio


# Type variable
T = TypeVar('T')


# Type alias (Python 3.9+)
UserId = str


@dataclass
class User:
    """A user entity with basic information."""
    id: UserId
    name: str
    email: str
    age: Optional[int] = None


class Repository(ABC, Generic[T]):
    """Abstract repository interface for data access.

    Args:
        T: The entity type this repository manages
    """

    @abstractmethod
    async def find_by_id(self, id: str) -> Optional[T]:
        """Find an entity by its ID.

        Args:
            id: The unique identifier

        Returns:
            The entity if found, None otherwise
        """
        pass

    @abstractmethod
    async def find_all(self) -> List[T]:
        """Get all entities.

        Returns:
            List of all entities
        """
        pass

    @abstractmethod
    async def save(self, item: T) -> None:
        """Save an entity.

        Args:
            item: The entity to save
        """
        pass

    @abstractmethod
    async def delete(self, id: str) -> bool:
        """Delete an entity by ID.

        Args:
            id: The entity ID to delete

        Returns:
            True if deleted, False if not found
        """
        pass


def greet(name: str) -> str:
    """A simple greeting function.

    Args:
        name: The name to greet

    Returns:
        A greeting message
    """
    return f"Hello, {name}!"


async def fetch_user(user_id: UserId) -> Optional[User]:
    """Fetch user data asynchronously.

    Args:
        user_id: The user ID to fetch

    Returns:
        The user data or None if not found

    Raises:
        ValueError: If user_id is empty
    """
    if not user_id:
        raise ValueError("user_id cannot be empty")

    await asyncio.sleep(0.1)  # Simulate network delay
    return User(
        id=user_id,
        name="Test User",
        email="test@example.com"
    )


def multiply(a: float, b: float) -> float:
    """Multiply two numbers.

    Args:
        a: First number
        b: Second number

    Returns:
        The product of a and b
    """
    return a * b


def _private_helper(value: str) -> str:
    """A private helper function."""
    return value.strip().lower()


class UserService(Repository[User]):
    """User service for managing users.

    This class provides CRUD operations for user entities.

    Attributes:
        service_name: The name of this service
        max_users: Maximum number of users allowed

    Example:
        >>> service = UserService(max_users=100)
        >>> await service.save(User(id="1", name="John", email="john@example.com"))
    """

    service_name: str = "UserService"

    def __init__(self, max_users: int = 100):
        """Initialize the user service.

        Args:
            max_users: Maximum number of users allowed
        """
        self._users: Dict[str, User] = {}
        self.max_users = max_users

    async def find_by_id(self, id: str) -> Optional[User]:
        """Find a user by ID."""
        return self._users.get(id)

    async def find_all(self) -> List[User]:
        """Get all users."""
        return list(self._users.values())

    async def save(self, user: User) -> None:
        """Save a user.

        Args:
            user: The user to save

        Raises:
            RuntimeError: If max users limit is reached
        """
        if len(self._users) >= self.max_users:
            raise RuntimeError("Max users reached")
        self._users[user.id] = user

    async def delete(self, id: str) -> bool:
        """Delete a user by ID."""
        if id in self._users:
            del self._users[id]
            return True
        return False

    @property
    def user_count(self) -> int:
        """Get the current number of users."""
        return len(self._users)

    @staticmethod
    def create(max_users: int = 100) -> "UserService":
        """Factory method to create a UserService.

        Args:
            max_users: Maximum number of users

        Returns:
            A new UserService instance
        """
        return UserService(max_users=max_users)

    def _validate_user(self, user: User) -> bool:
        """Validate a user (private method)."""
        return len(user.id) > 0 and "@" in user.email


def create_pair(first: T, second: T) -> tuple:
    """Create a pair of values.

    Args:
        first: First value
        second: Second value

    Returns:
        A tuple containing both values
    """
    return (first, second)


def number_generator(n: int):
    """Generate numbers from 0 to n-1.

    Args:
        n: Upper limit (exclusive)

    Yields:
        Numbers from 0 to n-1
    """
    for i in range(n):
        yield i


# Module-level constants
DEFAULT_PAGE_SIZE = 20
API_VERSION = "1.0.0"

# Exported symbols
__all__ = [
    "User",
    "Repository",
    "UserService",
    "greet",
    "fetch_user",
    "multiply",
    "create_pair",
    "DEFAULT_PAGE_SIZE",
    "API_VERSION",
]
