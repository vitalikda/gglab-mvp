import React, { useContext, useEffect, useState, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLocation } from "react-router-dom";
import Swal from "sweetalert2";
import LoadingScreen from "../../components/loading/LoadingScreen";
import socketContext from "../../context/websocket/socketContext";
import { CS_FETCH_LOBBY_INFO } from "../../pokergame/actions";
import { connectMetamask } from "../../utils/interact";
import globalContext from "./../../context/global/globalContext";
import "./ConnectWallet.scss";

/** @returns {URLSearchParams} */
const useQuery = () => {
	const { search } = useLocation();
	return useMemo(() => new URLSearchParams(search), [search]);
};

const useJoinGame = () => {
	const { setWalletAddress, setChipsAmount } = useContext(globalContext);
	const { socket } = useContext(socketContext);
	const navigate = useNavigate();

	/**
	 * @param {string} walletAddress
	 * @param {string} gameId
	 * @param {string} username
	 * @returns {Promise<void>}
	 */
	return async (walletAddress, gameId, username) => {
		try {
			console.log({ walletAddress, gameId, username });
			if (!walletAddress || !gameId || !username) {
				throw new Error("Invalid parameters");
			}

			setWalletAddress(walletAddress);
			socket.emit(CS_FETCH_LOBBY_INFO, {
				walletAddress,
				socketId: socket.id,
				gameId,
				username,
			});
			console.log(CS_FETCH_LOBBY_INFO, {
				walletAddress,
				socketId: socket.id,
				gameId,
				username,
			});

			navigate("/play");
		} catch (error) {
			console.log(error);
			return error;
		}
	};
};

const ConnectMetamaskButton = ({ callback }) => {
	const [loading, setLoading] = useState(false);

	return (
		<button
			type="button"
			className="btn btn-primary"
			onClick={async () => {
				setLoading(true);
				try {
					const { event, response } = await connectMetamask();
					if (event !== "connected") {
						throw new Error("Metamask not connected");
					}
					callback(response);
				} catch (error) {
					console.log(error);
				} finally {
					setLoading(false);
				}
			}}
		>
			{loading ? "Connecting..." : "Connect Metamask"}
		</button>
	);
};

const ConnectWallet = () => {
	const { socket } = useContext(socketContext);

	const [walletAddress, setWalletAddress] = useState("");
	const [username, setUsername] = useState("");
	const [loading, setLoading] = useState(false);
	const addressRef = useRef();

	const joinGame = useJoinGame();

	const handleSubmit = (e) => {
		e.preventDefault();

		console.log("Connecting...");
		setLoading(true);

		// TODO: get gameId from API - `getPokerTables`
		const gameId = "123"; // query.get("gameId");

		joinGame(walletAddress, gameId, username)
			.then(() => {
				setLoading(false);
			})
			.catch((error) => {
				setLoading(false);
				Swal.fire({
					title: "Error",
					text: error.message,
					icon: "error",
					confirmButtonText: "Ok",
				});
			});
	};

	// useEffect(() => {
	// 	if (socket !== null && socket.connected === true) {
	// 		console.log("Connecting...");
	// 		const walletAddress = query.get("walletAddress");
	// 		const gameId = query.get("gameId");
	// 		const username = query.get("username");
	// 		if (walletAddress && gameId && username) {
	// 			console.log(username);
	// 			setWalletAddress(walletAddress);
	// 			socket.emit(CS_FETCH_LOBBY_INFO, {
	// 				walletAddress,
	// 				socketId: socket.id,
	// 				gameId,
	// 				username,
	// 			});
	// 			console.log(CS_FETCH_LOBBY_INFO, {
	// 				walletAddress,
	// 				socketId: socket.id,
	// 				gameId,
	// 				username,
	// 			});
	// 			navigate("/play");
	// 		}
	// 	}
	// }, [socket]);

	if (socket === null || !socket.connected) {
		return <LoadingScreen />;
	}

	if (loading) {
		return <LoadingScreen />;
	}

	return (
		<form onSubmit={handleSubmit}>
			<div className="connect-wallet-area">
				<div className="connect-wallet-form">
					<div className="form-group">
						<label htmlFor="walletAddress">Wallet Address</label>
						{walletAddress ? (
							<input
								type="text"
								defaultValue={walletAddress}
								className="form-control"
								id="walletAddress"
								name="walletAddress"
								placeholder="Enter Wallet Address"
								required
							/>
						) : (
							<div>
								<ConnectMetamaskButton callback={setWalletAddress} />
							</div>
						)}
					</div>
					<div className="form-group">
						<label htmlFor="username">Username</label>
						<input
							type="text"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							className="form-control"
							id="username"
							name="username"
							placeholder="Enter Username"
							required
						/>
					</div>
					<button type="submit" className="btn btn-primary mt-auto">
						Connect
					</button>
				</div>
			</div>
		</form>
	);
};

export default ConnectWallet;
