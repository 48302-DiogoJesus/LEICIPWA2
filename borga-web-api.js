'use strict'
const express = require('express');
const error = require('./borga-errors')

// Random Token Generation
const crypto = require('crypto')

// Documentation imports
const YAML = require('yamljs')
const openApi = require('swagger-ui-express');
const openApiSpec = YAML.load('./docs/borga-spec.yaml');

module.exports = function (services, queue) {
	// Initialize express router
	const router = express.Router();
	// Add support for JSON inside express
	router.use(express.json());

	/**
	 * Get the user access token from request
	 * @param {req} Request object
	 * @returns the token extracted from the request headers
	 */
	function getBearerToken(req) {
		const auth = req.header('Authorization');
		if (auth) {
			const authData = auth.trim();
			if (authData.substr(0,6).toLowerCase() === 'bearer') {
				return authData.replace(/^bearer\s+/i, '');
			}
		}
		return null;
	}

	/**
	 * Handle Web Api Errors and pass them to client
	 * @param {err} error object thrown by other functions
	 * @param {req} request object 
	 * @param {res} response object
	 */
	function handleError(err, req, res) {
		if (!Object.keys(err).includes('http_code')) {
			res.status(500).json({ cause: err });
		} else {
			res.status(err.http_code).json({ cause: err });
		}
	}
    
	/* GAMES RELATED FUNCTIONS */
	// Group of functions to handle queries related to games functionality
    const validGamesQueries = {
		top : getTopNGames, 
		id : getGameById,
		name : getGameByName
	}

	/**
	 * Handle Games Queries (Ex: /games/search?id=yqR4PtpO8X)
	 * Based on the first query key execute the corresponding function
	 * and provide a response with JSON format
	 * @param {req} request object 
	 * @param {res} response object
	 */
	async function handleGameQueries(req, res) {
		try {
			// Extract first query key
			let command = Object.keys(req.query)[0]
			// If query is not recognized throw error
			if (!Object.keys(validGamesQueries).includes(command)) throw error.WEB_API_INVALID_QUERY
			// Since this function calls the Exteral API it makes sense to queue here
			await queue.wait()
			// Call right function with parameter being req.query[top]
			validGamesQueries[command](req.query[command], req, res)
		} catch (err) {
			handleError(err, req, res)
		}
	}

	/**
	 * Get Game ID
	 * @param {id} Game ID 
	 * @param {req} request object 
	 * @param {res} response object
	 * Responds with game object or throws exception if game with [id] does not exist
	 */
	async function getGameById(id, req, res) {
		try {
			let gameObject = await services.getGameById(id)
			res.status(200).json(gameObject)
		} catch (err) {
			handleError(err, req, res)
		}
	}

	/**
	 * Get Game ID
	 * @param {n} limit of elements to search for in the top of popularity
	 * @param {req} request object 
	 * @param {res} response object
	 * Responds  with top n popular games list or throws unknown exceptions
	 */
	async function getTopNGames(n, req, res) {
		try {	
			let popularGamesList = await services.getPopularGamesList(n)
			res.status(200).json(popularGamesList)
		} catch (err) {
			handleError(err, req, res)
		}
	}

	/**
	 * Get Games List by Name
	 * @param {name} name 
	 * @param {req} request object 
	 * @param {res} response object
	 * Responds with a list of all the games found by searching external Games API for [name]
	 */
	async function getGameByName(name, req, res) {
		try {
			let game = await services.getGameByName(name)
			res.status(200).json(game)
		} catch (err) {
			handleError(err, req, res)
		}
	}

	/* GROUPS RELATED FUNCTIONS */

	/**
	 * Create a group
	 * @param {req} request object 
	 * @param {res} response object
	 * Responds with a the id of the group created
	 */
	async function handleCreateGroup(req, res) {
		try {
			// Make sure token is valid
			await services.getUsername(getBearerToken(req))
			let newGroupName = req.body.name
			let newGroupDescription = req.body.description
			if ((newGroupName == undefined) && (newGroupDescription == undefined)) throw error.WEB_API_INVALID_GROUP_DETAILS
			let groupID = await services.executeAuthed(getBearerToken(req),'createGroup', newGroupName, newGroupDescription)
			res.status(201).json({ id : groupID })
		} catch (err) {
			handleError(err, req, res)
		}
	}

	/**
	 * Delete a group
	 * @param {req} request object 
	 * @param {res} response object
	 */
	async function handleDeleteGroup(req, res) {
		try {
			// Make sure token is valid
			await services.getUsername(getBearerToken(req))
			let group_id = req.params.group_id
			if (!group_id) throw error.GLOBAL_MISSING_PARAM
			await services.executeAuthed(getBearerToken(req), 'deleteGroup', group_id)
			res.sendStatus(200)
		} catch (err) {
			handleError(err, req, res)
		}
	}

	/**
	 * Update group information
	 * @param {req} request object 
	 * @param {res} response object
	 * Responds with the object of the updated group
	 */
	async function handleUpdateGroup(req, res) {
		try {
			// Make sure token is valid
			await services.getUsername(getBearerToken(req))
			let id = req.params.group_id 
			if (!id) throw error.GLOBAL_MISSING_PARAM
			// Avoid going any further if group does not exist even though changeGroupName will throw if it does not
			if (!(await services.getGroup(id))) throw error.DATA_MEM_GROUP_DOES_NOT_EXIST
			let newName = req.body.name
			let newDescription = req.body.description
			if (!newName && !newDescription) throw error.WEB_API_INVALID_GROUP_DETAILS
			if (newName) await services.executeAuthed(getBearerToken(req), 'changeGroupName', id, newName)
			if (newDescription) await services.executeAuthed(getBearerToken(req), 'changeGroupDescription', id, newDescription)

			res.status(200).json( { id : await services.getGroup(id) } )
		} catch (err) {
			handleError(err, req, res)
		} 
	}

	/**
	 * Get a group by its ID
	 * @param {req} request object 
	 * @param {res} response object
	 * Responds with a group object
	 */
	async function handleGetGroupById(req, res){
		try {
			// Make sure token is valid
			await services.getUsername(getBearerToken(req))
			let group_id = req.params.group_id
			if (!group_id) throw error.GLOBAL_MISSING_PARAM
			let group = await services.getGroupDetails(group_id)
			res.status(200).json(group)
		}
		catch(err){
			handleError(err,req,res)
		}
	}

	/**
	 * Get all groups
	 * @param {req} request object 
	 * @param {res} response object
	 * Responds a list with all groups the application contains
	 */
	async function handleGetGroups(req, res) {
		try {
			// Make sure token is valid
			await services.getUsername(getBearerToken(req))
			let groups = await services.getGroups()
			res.status(200).json(groups)
		} catch (err) {
			handleError(err, req, res)
		}
	} 

	/**
	 * Create a user
	 * @param {req} request object 
	 * @param {res} response object
	 * Responds with a bearer token for the created user
	 */
	async function handleCreateUser(req, res) {
		try {	
			let newUserName = req.body.username
			if (!newUserName) throw error.GLOBAL_MISSING_PARAM
			let newToken = crypto.randomUUID()
			let newTokenValidated = await services.createUser(newUserName, newToken)
			res.status(201).json({ 'token' : newTokenValidated })
		} catch (err) {
			handleError(err, req, res)
		}
	}  

	/**
	 * Get a User
	 * @param {req} request object 
	 * @param {res} response object
	 * Responds with a bearer token for the created user
	 */
	async function handleGetUser(req, res){
		try {
			let username = req.params.username
			if (!username) throw error.GLOBAL_MISSING_PARAM
			let user = await services.getUser(username) 

			res.status(200).json(user)
		} catch (err) {
			handleError(err, req, res)
		}
	} 

	/**
	 * Add Group Ref. to a user
	 * @param {req} request object 
	 * @param {res} response object
	 * Responds with the updated user object
	 */
	async function handleAddGroupToUser(req,res){
		try{
			let group_id = req.body.id 
			if (!group_id) throw error.GLOBAL_MISSING_PARAM
			let updatedUser = await services.executeAuthed(getBearerToken(req),'addGroupToUser', group_id)

			res.status(200).json(await services.getUser(updatedUser))
		} catch (err) {
			handleError(err, req, res)
		}
	} 

	/**
	 * Remove Group Ref. to a user
	 * @param {req} request object 
	 * @param {res} response object
	 * Responds with the updated user object
	 */
	async function handleDeleteGroupFromUser(req,res){
		try {
			let group_id = req.params.group_id 
			if (!group_id) throw error.GLOBAL_MISSING_PARAM
			let updatedUser = await services.executeAuthed(getBearerToken(req),'deleteGroupFromUser', group_id)
			
			res.status(200).json(await services.getUser(updatedUser))
		} catch (err) {
			handleError(err, req, res)
		}
	} 

	/*-----------------------Group Game Functions--------------------------- */

	/**
	 * Add Game to a group
	 * @param {req} request object 
	 * @param {res} response object
	 * Responds with the updated user object
	 */
	async function handleAddGameToGroup(req,res){
		try {
			// Make sure token is valid
			await services.getUsername(getBearerToken(req))
			let new_game_id = req.body.id  
			let group_id = req.params.group_id
			if (!new_game_id || !group_id) throw error.GLOBAL_MISSING_PARAM
			let updatedGroup = await services.executeAuthed(getBearerToken(req), 'addGameToGroupByID', group_id, new_game_id) 
			
			res.status(201).json(updatedGroup)
		} catch (err) { 
			handleError(err, req, res)
		} 
	} 

	/**
	 * Delete game from a group
	 * @param {req} request object 
	 * @param {res} response object
	 * Responds with the updated group object
	 */
	async function handleDeleteGameFromGroup(req, res) {
		try {
			// Make sure token is valid
			await services.getUsername(getBearerToken(req))
			let game_id = req.params.game_id 
			let group_id = req.params.group_id
			if (!game_id || !group_id) throw error.GLOBAL_MISSING_PARAM
			await services.executeAuthed(getBearerToken(req), 'deleteGameFromGroup', group_id, game_id) 
			let group = await services.getGroupDetails(group_id)

			res.status(200).json(group)
		} catch (err) {
			handleError(err, req, res)
		}
	}

	// Serve the API documentation
	router.use('/docs', openApi.serve);
	router.get('/docs', openApi.setup(openApiSpec));

	// API PATH HANDLING \\

	// Resource: /games
	router.get('/games', handleGameQueries);

	// Resource: /groups
	router.get('/groups', handleGetGroups)
	router.get('/groups/:group_id', handleGetGroupById)
	router.post('/groups', handleCreateGroup)
	router.delete('/groups/:group_id', handleDeleteGroup)
	router.put('/groups/:group_id', handleUpdateGroup)

	// Resource: /groups/games
	router.post('/groups/:group_id/games',handleAddGameToGroup)
	router.delete('/groups/:group_id/games/:game_id', handleDeleteGameFromGroup)

	// Resource: /users
	router.post('/users', handleCreateUser)  
	router.get('/users/:username', handleGetUser)
	
	// Resource: /users/groups
	router.post('/users/groups', handleAddGroupToUser) 
	router.delete('/users/groups/:group_id',  handleDeleteGroupFromUser)

	return router;
};