from http import HTTPStatus
from typing import Annotated, Literal, Optional, Type, Union

from fastapi import Cookie, Depends, Query, Request, Security
from fastapi.exceptions import HTTPException
from fastapi.openapi.models import APIKey, APIKeyIn
from fastapi.security import APIKeyHeader, APIKeyQuery, OAuth2PasswordBearer
from fastapi.security.base import SecurityBase
from jose import ExpiredSignatureError, JWTError, jwt
from loguru import logger
from pydantic.types import UUID4

from lnbits.core.crud import (
    get_account,
    get_account_by_email,
    get_account_by_username,
    get_user,
    get_wallet_for_key,
)
from lnbits.core.models import User, WalletType, WalletTypeInfo
from lnbits.db import Filter, Filters, TFilterModel
from lnbits.settings import AuthMethods, settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/v1/auth", auto_error=False)


# TODO: fix type ignores
class KeyChecker(SecurityBase):
    def __init__(
        self,
        scheme_name: Optional[str] = None,
        auto_error: bool = True,
        api_key: Optional[str] = None,
    ):
        self.scheme_name = scheme_name or self.__class__.__name__
        self.auto_error = auto_error
        self._key_type = WalletType.invoice
        self._api_key = api_key
        if api_key:
            key = APIKey(
                **{"in": APIKeyIn.query},  # type: ignore
                name="X-API-KEY",
                description="Wallet API Key - QUERY",
            )
        else:
            key = APIKey(
                **{"in": APIKeyIn.header},  # type: ignore
                name="X-API-KEY",
                description="Wallet API Key - HEADER",
            )
        self.wallet = None
        self.model: APIKey = key

    async def __call__(self, request: Request):
        try:
            key_value = (
                self._api_key
                if self._api_key
                else request.headers.get("X-API-KEY") or request.query_params["api-key"]
            )
            # FIXME: Find another way to validate the key. A fetch from DB should be
            #        avoided here. Also, we should not return the wallet here - thats
            #        silly. Possibly store it in a Redis DB
            wallet = await get_wallet_for_key(key_value, self._key_type)
            if not wallet or wallet.deleted:
                raise HTTPException(
                    status_code=HTTPStatus.UNAUTHORIZED,
                    detail="Invalid key or wallet.",
                )
            self.wallet = wallet  # type: ignore
        except KeyError:
            raise HTTPException(
                status_code=HTTPStatus.BAD_REQUEST, detail="`X-API-KEY` header missing."
            )


class WalletInvoiceKeyChecker(KeyChecker):
    """
    WalletInvoiceKeyChecker will ensure that the provided invoice
    wallet key is correct and populate g().wallet with the wallet
    for the key in `X-API-key`.

    The checker will raise an HTTPException when the key is wrong in some ways.
    """

    def __init__(
        self,
        scheme_name: Optional[str] = None,
        auto_error: bool = True,
        api_key: Optional[str] = None,
    ):
        super().__init__(scheme_name, auto_error, api_key)
        self._key_type = WalletType.invoice


class WalletAdminKeyChecker(KeyChecker):
    """
    WalletAdminKeyChecker will ensure that the provided admin
    wallet key is correct and populate g().wallet with the wallet
    for the key in `X-API-key`.

    The checker will raise an HTTPException when the key is wrong in some ways.
    """

    def __init__(
        self,
        scheme_name: Optional[str] = None,
        auto_error: bool = True,
        api_key: Optional[str] = None,
    ):
        super().__init__(scheme_name, auto_error, api_key)
        self._key_type = WalletType.admin


api_key_header = APIKeyHeader(
    name="X-API-KEY",
    auto_error=False,
    description="Admin or Invoice key for wallet API's",
)
api_key_query = APIKeyQuery(
    name="api-key",
    auto_error=False,
    description="Admin or Invoice key for wallet API's",
)


async def get_key_type(
    r: Request,
    api_key_header: str = Security(api_key_header),
    api_key_query: str = Security(api_key_query),
) -> WalletTypeInfo:
    token = api_key_header or api_key_query

    if not token:
        raise HTTPException(
            status_code=HTTPStatus.UNAUTHORIZED,
            detail="Invoice (or Admin) key required.",
        )

    for wallet_type, WalletChecker in zip(
        [WalletType.admin, WalletType.invoice],
        [WalletAdminKeyChecker, WalletInvoiceKeyChecker],
    ):
        try:
            checker = WalletChecker(api_key=token)
            await checker.__call__(r)
            if checker.wallet is None:
                raise HTTPException(
                    status_code=HTTPStatus.NOT_FOUND, detail="Wallet does not exist."
                )
            wallet = WalletTypeInfo(wallet_type, checker.wallet)
            if (
                wallet.wallet.user != settings.super_user
                and wallet.wallet.user not in settings.lnbits_admin_users
            ) and (
                settings.lnbits_admin_extensions
                and r["path"].split("/")[1] in settings.lnbits_admin_extensions
            ):
                raise HTTPException(
                    status_code=HTTPStatus.FORBIDDEN,
                    detail="User not authorized for this extension.",
                )
            return wallet
        except HTTPException as exc:
            if exc.status_code == HTTPStatus.BAD_REQUEST:
                raise
            elif exc.status_code == HTTPStatus.UNAUTHORIZED:
                # we pass this in case it is not an invoice key, nor an admin key,
                # and then return NOT_FOUND at the end of this block
                pass
            else:
                raise
        except Exception:
            raise
    raise HTTPException(
        status_code=HTTPStatus.NOT_FOUND, detail="Wallet does not exist."
    )


async def require_admin_key(
    r: Request,
    api_key_header: str = Security(api_key_header),
    api_key_query: str = Security(api_key_query),
):
    token = api_key_header or api_key_query

    if not token:
        raise HTTPException(
            status_code=HTTPStatus.UNAUTHORIZED,
            detail="Admin key required.",
        )

    wallet = await get_key_type(r, token)

    if wallet.wallet_type != 0:
        # If wallet type is not admin then return the unauthorized status
        # This also covers when the user passes an invalid key type
        raise HTTPException(
            status_code=HTTPStatus.UNAUTHORIZED, detail="Admin key required."
        )
    else:
        return wallet


async def require_invoice_key(
    r: Request,
    api_key_header: str = Security(api_key_header),
    api_key_query: str = Security(api_key_query),
):
    token = api_key_header or api_key_query

    if not token:
        raise HTTPException(
            status_code=HTTPStatus.UNAUTHORIZED,
            detail="Invoice (or Admin) key required.",
        )

    wallet = await get_key_type(r, token)

    if (
        wallet.wallet_type != WalletType.admin
        and wallet.wallet_type != WalletType.invoice
    ):
        raise HTTPException(
            status_code=HTTPStatus.UNAUTHORIZED,
            detail="Invoice (or Admin) key required.",
        )
    else:
        return wallet


async def check_access_token(
    header_access_token: Annotated[Union[str, None], Depends(oauth2_scheme)],
    cookie_access_token: Annotated[Union[str, None], Cookie()] = None,
) -> Optional[str]:
    return header_access_token or cookie_access_token


async def check_user_exists(
    r: Request,
    access_token: Annotated[Optional[str], Depends(check_access_token)],
    usr: Optional[UUID4] = None,
) -> User:
    if access_token:
        account = await _get_account_from_token(access_token)
    elif usr and settings.is_auth_method_allowed(AuthMethods.user_id_only):
        account = await get_account(usr.hex)
    else:
        raise HTTPException(HTTPStatus.UNAUTHORIZED, "Missing user ID or access token.")

    
    # KYC 인증 전 허용할 패스 목록
    allowed_paths = ["/account", "/api/v1/auth", "/api/v1/auth/update", "/api/v1/auth/kyc"]

    # KYC 인증 전 허용할 패스 목록에 포함되어 있지 않으면 KYC 인증 필요
    if r.url.path not in allowed_paths:

        # KYC 인증 형태로 변경
        if not account or not settings.is_user_allowed(account.id):
            # raise HTTPException(HTTPStatus.UNAUTHORIZED, "User not allowed.")
            raise HTTPException("error-kyc", "KYC Required.")

    user = await get_user(account.id)
    assert user, "User not found for account."

    if not user.admin and r["path"].split("/")[1] in settings.lnbits_admin_extensions:
        raise HTTPException(HTTPStatus.FORBIDDEN, "User not authorized for extension.")

    return user


async def check_admin(user: Annotated[User, Depends(check_user_exists)]) -> User:
    if user.id != settings.super_user and user.id not in settings.lnbits_admin_users:
        raise HTTPException(
            HTTPStatus.UNAUTHORIZED, "User not authorized. No admin privileges."
        )

    return user


async def check_super_user(user: Annotated[User, Depends(check_user_exists)]) -> User:
    if user.id != settings.super_user:
        raise HTTPException(
            HTTPStatus.UNAUTHORIZED, "User not authorized. No super user privileges."
        )
    return user


def parse_filters(model: Type[TFilterModel]):
    """
    Parses the query params as filters.
    :param model: model used for validation of filter values
    """

    def dependency(
        request: Request,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        sortby: Optional[str] = None,
        direction: Optional[Literal["asc", "desc"]] = None,
        search: Optional[str] = Query(None, description="Text based search"),
    ):
        params = request.query_params
        filters = []
        for key in params.keys():
            try:
                filters.append(Filter.parse_query(key, params.getlist(key), model))
            except ValueError:
                continue

        return Filters(
            filters=filters,
            limit=limit,
            offset=offset,
            sortby=sortby,
            direction=direction,
            search=search,
            model=model,
        )

    return dependency


async def _get_account_from_token(access_token):
    try:
        payload = jwt.decode(access_token, settings.auth_secret_key, "HS256")
        if "sub" in payload and payload.get("sub"):
            return await get_account_by_username(str(payload.get("sub")))
        if "usr" in payload and payload.get("usr"):
            return await get_account(str(payload.get("usr")))
        if "email" in payload and payload.get("email"):
            return await get_account_by_email(str(payload.get("email")))

        raise HTTPException(HTTPStatus.UNAUTHORIZED, "Data missing for access token.")
    except ExpiredSignatureError:
        raise HTTPException(
            HTTPStatus.UNAUTHORIZED, "Session expired.", {"token-expired": "true"}
        )
    except JWTError as e:
        logger.debug(e)
        raise HTTPException(HTTPStatus.UNAUTHORIZED, "Invalid access token.")
